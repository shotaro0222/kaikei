import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import {
  HttpError, NEW_JOURNAL_ID, deleteJournalStmts, getAccounts, getApportionRules, getRules, getSettings,
  insertJournal, loadJournals, normalizeJournal, systemAccounts, updateJournal,
} from "../db";
import type { Account, ApportionRule, Direction, JournalInput, TaxCategory } from "../lib/types";
import { isValidDate, TAX_CATEGORIES } from "../lib/types";
import { buildQuickLines } from "../lib/journal";
import { classify, type Suggestion } from "../lib/classifier";
import { learningKey } from "../lib/normalize";
import { aiClassify } from "../lib/ai";

export const journalRoutes = new Hono<AppEnv>();

/** 推定（ルール → 辞書 → AI） */
export async function suggest(env: Env, text: string, direction: Direction, amount: number, ctx?: { accounts?: Account[]; aiEnabled?: boolean }): Promise<Suggestion> {
  const accounts = ctx?.accounts ?? (await getAccounts(env.DB));
  const rules = await getRules(env.DB);
  const s = classify(text, direction, rules, accounts);
  const aiEnabled = ctx?.aiEnabled ?? (await getSettings(env.DB)).ai_enabled !== "false";
  if (s.confidence < 0.5 && aiEnabled && text.trim()) {
    const ai = await aiClassify(env, text, direction, amount, accounts);
    if (ai) return ai;
  }
  return s;
}

/** 費用科目の入力時按分ルールを考慮して仕訳明細を作る */
export function linesFor(
  accounts: Account[],
  apportion: ApportionRule[],
  p: { direction: Direction; amount: number; account_id: number; counter_account_id: number; tax_category: TaxCategory },
) {
  const sys = systemAccounts(accounts);
  const rule = apportion.find((r) => r.account_id === p.account_id && r.active && r.timing === "entry");
  try {
    return {
      lines: buildQuickLines({
        ...p,
        business_ratio: p.direction === "expense" ? rule?.business_ratio : undefined,
        owner_draw_id: sys.ownerDraw,
        owner_contrib_id: sys.ownerContrib,
      }),
      apportion: rule ?? null,
    };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

/** 確定した仕訳から自動仕訳ルールを学習する SQL */
export function learnStmt(db: D1Database, text: string, direction: Direction, account_id: number, tax: TaxCategory | null, partner: string | null): D1PreparedStatement | null {
  const key = learningKey(text);
  if (key.length < 2) return null;
  return db
    .prepare(
      `INSERT INTO classification_rules (keyword, match_type, direction, account_id, tax_category, partner, kind, hits)
       VALUES (?, 'exact', ?, ?, ?, ?, 'learned', 1)
       ON CONFLICT(keyword, match_type, direction) DO UPDATE SET
         account_id = CASE WHEN kind = 'learned' THEN excluded.account_id ELSE account_id END,
         tax_category = CASE WHEN kind = 'learned' THEN excluded.tax_category ELSE tax_category END,
         partner = COALESCE(excluded.partner, partner),
         hits = hits + 1`,
    )
    .bind(key, direction, account_id, tax, partner);
}

journalRoutes.post("/quick/suggest", async (c) => {
  const b = await c.req.json<{ description: string; amount: number; direction: Direction; counter_account_id?: number; account_id?: number; tax_category?: TaxCategory }>();
  const direction: Direction = b.direction === "income" ? "income" : "expense";
  const amount = Math.round(Number(b.amount) || 0);
  const [accounts, apportion] = await Promise.all([getAccounts(c.env.DB), getApportionRules(c.env.DB)]);
  const sys = systemAccounts(accounts);
  const s = b.account_id
    ? { account_id: b.account_id, tax_category: accounts.find((a) => a.id === b.account_id)?.tax_default ?? "out", partner: null, confidence: 1, source: "user", reason: "手動選択" }
    : await suggest(c.env, b.description ?? "", direction, amount, { accounts });
  const tax = TAX_CATEGORIES.includes(b.tax_category as TaxCategory) ? b.tax_category! : (s.tax_category as TaxCategory);
  const counter = b.counter_account_id || (direction === "income" ? sys.bank : sys.cash);
  let preview = null;
  let error: string | null = null;
  if (amount > 0) {
    try {
      preview = linesFor(accounts, apportion, { direction, amount, account_id: s.account_id, counter_account_id: counter, tax_category: tax });
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return c.json({ suggestion: { ...s, tax_category: tax }, counter_account_id: counter, lines: preview?.lines ?? [], apportion: preview?.apportion ?? null, error });
});

// ---------- 仕訳 CRUD ----------
journalRoutes.get("/journals", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.from && isValidDate(q.from)) (where.push("j.date >= ?"), binds.push(q.from));
  if (q.to && isValidDate(q.to)) (where.push("j.date <= ?"), binds.push(q.to));
  if (q.source) (where.push("j.source = ?"), binds.push(q.source));
  if (q.q) {
    where.push("(j.description LIKE ? OR j.partner LIKE ? OR j.memo LIKE ?)");
    const like = `%${q.q}%`;
    binds.push(like, like, like);
  }
  if (q.account_id) (where.push("EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id = j.id AND l.account_id = ?)"), binds.push(Number(q.account_id)));
  if (q.amount) (where.push("EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id = j.id AND l.amount = ?)"), binds.push(Number(q.amount)));
  const limit = Math.min(Number(q.limit) || 100, 500);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [ids, total] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT j.id FROM journals j ${w} ORDER BY j.date DESC, j.id DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM journals j ${w}`).bind(...binds),
  ]);
  const items = await loadJournals(c.env.DB, (ids.results as Array<{ id: number }>).map((r) => r.id));
  return c.json({ items, total: (total.results[0] as { n: number }).n });
});

journalRoutes.get("/journals/:id", async (c) => {
  const [j] = await loadJournals(c.env.DB, [Number(c.req.param("id"))]);
  if (!j) throw new HttpError(404, "仕訳が見つかりません");
  return c.json(j);
});

interface JournalBody extends JournalInput {
  learn?: { text: string; direction: Direction; account_id: number; tax_category?: TaxCategory };
  receipt_ids?: number[];
}

journalRoutes.post("/journals", async (c) => {
  const b = await c.req.json<JournalBody>();
  const accounts = await getAccounts(c.env.DB);
  const j = normalizeJournal({ ...b, source: b.source === "quick" ? "quick" : "manual", source_ref: null }, accounts);
  const extra: D1PreparedStatement[] = [];
  if (b.learn?.text) {
    const s = learnStmt(c.env.DB, b.learn.text, b.learn.direction, b.learn.account_id, b.learn.tax_category ?? null, j.partner ?? null);
    if (s) extra.push(s);
  }
  for (const rid of b.receipt_ids ?? []) extra.push(c.env.DB.prepare(`UPDATE receipts SET journal_id = ${NEW_JOURNAL_ID} WHERE id = ?`).bind(Number(rid)));
  const id = await insertJournal(c.env.DB, j, extra);
  return c.json({ id });
});

journalRoutes.put("/journals/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [before] = await loadJournals(c.env.DB, [id]);
  if (!before) throw new HttpError(404, "仕訳が見つかりません");
  const accounts = await getAccounts(c.env.DB);
  const j = normalizeJournal(await c.req.json<JournalInput>(), accounts);
  await updateJournal(c.env.DB, id, j, before);
  return c.json({ ok: true });
});

journalRoutes.delete("/journals/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [before] = await loadJournals(c.env.DB, [id]);
  if (!before) throw new HttpError(404, "仕訳が見つかりません");
  await c.env.DB.batch(deleteJournalStmts(c.env.DB, id, before));
  return c.json({ ok: true });
});

journalRoutes.get("/partners", async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT partner, COUNT(*) AS n FROM journals WHERE partner IS NOT NULL AND partner <> '' GROUP BY partner ORDER BY n DESC LIMIT 200",
  ).all<{ partner: string }>();
  return c.json(r.results.map((x) => x.partner));
});

journalRoutes.get("/audit-log", async (c) => {
  const q = c.req.query();
  const r = q.entity && q.entity_id
    ? await c.env.DB.prepare("SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC").bind(q.entity, Number(q.entity_id)).all()
    : await c.env.DB.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").bind(Math.min(Number(q.limit) || 200, 1000)).all();
  return c.json(r.results);
});
