import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { HttpError } from "../db";
import { sha256Hex, randomId } from "../lib/crypto";
import { isValidDate } from "../lib/types";

export const receiptRoutes = new Hono<AppEnv>();

const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf|text\/(plain|csv|xml)|application\/xml)$/;

export interface ReceiptMeta {
  doc_type?: string;
  issued_date?: string | null;
  amount?: number | null;
  partner?: string | null;
  memo?: string | null;
  journal_id?: number | null;
}

function cleanMeta(m: ReceiptMeta) {
  return {
    doc_type: ["receipt", "invoice", "quote", "contract", "other"].includes(m.doc_type ?? "") ? m.doc_type! : "receipt",
    issued_date: m.issued_date && isValidDate(m.issued_date) ? m.issued_date : null,
    amount: m.amount != null && String(m.amount) !== "" && Number.isFinite(Number(m.amount)) ? Math.round(Number(m.amount)) : null,
    partner: m.partner ? String(m.partner).slice(0, 200) : null,
    memo: m.memo ? String(m.memo).slice(0, 1000) : null,
    journal_id: m.journal_id ? Number(m.journal_id) : null,
  };
}

/** R2 に保存して receipts に登録（アップロード / メール受信の共通処理） */
export async function storeReceipt(env: Env, file: { name: string; type: string; data: ArrayBuffer }, meta: ReceiptMeta, source: "upload" | "email"): Promise<number> {
  if (file.data.byteLength > MAX_SIZE) throw new HttpError(413, "ファイルサイズは20MBまでです");
  const type = file.type || "application/octet-stream";
  if (!ALLOWED.test(type)) throw new HttpError(415, `対応していないファイル形式です (${type})`);
  const hash = await sha256Hex(file.data);
  const now = new Date();
  const key = `receipts/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomId(9)}-${file.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
  await env.RECEIPTS.put(key, file.data, {
    httpMetadata: { contentType: type },
    customMetadata: { sha256: hash, original_name: encodeURIComponent(file.name) },
  });
  const m = cleanMeta(meta);
  const r = await env.DB.prepare(
    `INSERT INTO receipts (storage, r2_key, file_name, mime_type, size, sha256, doc_type, issued_date, amount, partner, memo, journal_id, source)
     VALUES ('r2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(key, file.name.slice(0, 255), type, file.data.byteLength, hash, m.doc_type, m.issued_date, m.amount, m.partner, m.memo, m.journal_id, source)
    .run();
  const id = Number(r.meta.last_row_id);
  await env.DB.prepare("INSERT INTO audit_log (action, entity, entity_id, after_json) VALUES ('create', 'receipt', ?, ?)")
    .bind(id, JSON.stringify({ file_name: file.name, sha256: hash, ...m }))
    .run();
  return id;
}

// 一覧・検索（電子帳簿保存法の検索要件: 取引年月日の範囲・金額の範囲・取引先）
receiptRoutes.get("/receipts", async (c) => {
  const q = c.req.query();
  const where = ["r.deleted_at IS NULL"];
  const binds: unknown[] = [];
  if (q.from) (where.push("r.issued_date >= ?"), binds.push(q.from));
  if (q.to) (where.push("r.issued_date <= ?"), binds.push(q.to));
  if (q.min) (where.push("r.amount >= ?"), binds.push(Number(q.min)));
  if (q.max) (where.push("r.amount <= ?"), binds.push(Number(q.max)));
  if (q.partner) (where.push("r.partner LIKE ?"), binds.push(`%${q.partner}%`));
  if (q.q) (where.push("(r.file_name LIKE ? OR r.memo LIKE ? OR r.partner LIKE ?)"), binds.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`));
  if (q.unlinked === "1") where.push("r.journal_id IS NULL");
  if (q.journal_id) (where.push("r.journal_id = ?"), binds.push(Number(q.journal_id)));
  const r = await c.env.DB.prepare(
    `SELECT r.*, j.date AS journal_date, j.description AS journal_description
       FROM receipts r LEFT JOIN journals j ON j.id = r.journal_id
      WHERE ${where.join(" AND ")} ORDER BY COALESCE(r.issued_date, substr(r.uploaded_at, 1, 10)) DESC, r.id DESC LIMIT 500`,
  )
    .bind(...binds)
    .all();
  return c.json(r.results);
});

receiptRoutes.post("/receipts", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (files.length === 0) throw new HttpError(400, "ファイルを選択してください");
  const meta: ReceiptMeta = {
    doc_type: String(form.get("doc_type") ?? ""),
    issued_date: String(form.get("issued_date") ?? ""),
    amount: form.get("amount") ? Number(form.get("amount")) : null,
    partner: String(form.get("partner") ?? ""),
    memo: String(form.get("memo") ?? ""),
    journal_id: form.get("journal_id") ? Number(form.get("journal_id")) : null,
  };
  const ids: number[] = [];
  for (const f of files) ids.push(await storeReceipt(c.env, { name: f.name, type: f.type, data: await f.arrayBuffer() }, meta, "upload"));
  return c.json({ ids });
});

// 外部ドライブ（Google ドライブ・Dropbox・OneDrive 等）のファイルを URL で紐付け
receiptRoutes.post("/receipts/link", async (c) => {
  const b = await c.req.json<ReceiptMeta & { url: string; file_name?: string }>();
  let url: URL;
  try {
    url = new URL(b.url);
  } catch {
    throw new HttpError(400, "URL が不正です");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "https の URL を指定してください");
  const m = cleanMeta(b);
  const r = await c.env.DB.prepare(
    `INSERT INTO receipts (storage, external_url, file_name, doc_type, issued_date, amount, partner, memo, journal_id, source)
     VALUES ('external', ?, ?, ?, ?, ?, ?, ?, ?, 'link')`,
  )
    .bind(url.toString(), (b.file_name || url.pathname.split("/").pop() || url.hostname).slice(0, 255), m.doc_type, m.issued_date, m.amount, m.partner, m.memo, m.journal_id)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

receiptRoutes.put("/receipts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!before) throw new HttpError(404, "書類が見つかりません");
  const m = cleanMeta(await c.req.json<ReceiptMeta>());
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE receipts SET doc_type = ?, issued_date = ?, amount = ?, partner = ?, memo = ?, journal_id = ? WHERE id = ?").bind(
      m.doc_type, m.issued_date, m.amount, m.partner, m.memo, m.journal_id, id,
    ),
    c.env.DB.prepare("INSERT INTO audit_log (action, entity, entity_id, before_json, after_json) VALUES ('update', 'receipt', ?, ?, ?)").bind(
      id, JSON.stringify(before), JSON.stringify(m),
    ),
  ]);
  return c.json({ ok: true });
});

// 削除は論理削除（ファイルは保存期間中保持し、履歴を残す）
receiptRoutes.delete("/receipts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const before = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ? AND deleted_at IS NULL").bind(id).first();
  if (!before) throw new HttpError(404, "書類が見つかりません");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE receipts SET deleted_at = datetime('now'), journal_id = NULL WHERE id = ?").bind(id),
    c.env.DB.prepare("INSERT INTO audit_log (action, entity, entity_id, before_json) VALUES ('delete', 'receipt', ?, ?)").bind(id, JSON.stringify(before)),
  ]);
  return c.json({ ok: true });
});

receiptRoutes.get("/receipts/:id/file", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM receipts WHERE id = ?").bind(Number(c.req.param("id"))).first<{ storage: string; r2_key: string; external_url: string; mime_type: string; file_name: string }>();
  if (!r) throw new HttpError(404, "書類が見つかりません");
  if (r.storage === "external") return c.redirect(r.external_url);
  const obj = await c.env.RECEIPTS.get(r.r2_key);
  if (!obj) throw new HttpError(404, "ファイルが見つかりません");
  // 画像・PDF のみブラウザ内表示。それ以外（XML 等）はダウンロードさせる
  const inline = /^(image\/|application\/pdf)/.test(r.mime_type || "");
  return new Response(obj.body, {
    headers: {
      "Content-Type": r.mime_type || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(r.file_name)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// 紐付け候補の仕訳（金額一致・日付±7日）
receiptRoutes.get("/receipts/:id/candidates", async (c) => {
  const r = await c.env.DB.prepare("SELECT issued_date, amount, partner FROM receipts WHERE id = ?").bind(Number(c.req.param("id"))).first<{ issued_date: string | null; amount: number | null; partner: string | null }>();
  if (!r) throw new HttpError(404, "書類が見つかりません");
  if (!r.amount && !r.issued_date) return c.json([]);
  const res = await c.env.DB.prepare(
    `SELECT j.id, j.date, j.description, j.partner, MAX(l.amount) AS amount,
            (CASE WHEN ?1 IS NOT NULL AND EXISTS (SELECT 1 FROM journal_lines x WHERE x.journal_id = j.id AND x.amount = ?1) THEN 2 ELSE 0 END)
          + (CASE WHEN ?2 IS NOT NULL AND abs(julianday(j.date) - julianday(?2)) <= 7 THEN 1 ELSE 0 END) AS score
       FROM journals j JOIN journal_lines l ON l.journal_id = j.id
      WHERE (?1 IS NULL OR EXISTS (SELECT 1 FROM journal_lines x WHERE x.journal_id = j.id AND x.amount = ?1))
        AND (?2 IS NULL OR abs(julianday(j.date) - julianday(?2)) <= 31)
      GROUP BY j.id ORDER BY score DESC, abs(julianday(j.date) - julianday(COALESCE(?2, j.date))) LIMIT 10`,
  )
    .bind(r.amount, r.issued_date)
    .all();
  return c.json(res.results);
});
