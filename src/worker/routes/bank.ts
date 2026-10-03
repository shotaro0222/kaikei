import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import {
  HttpError, NEW_JOURNAL_ID, getAccounts, getApportionRules, getRules, insertJournal, systemAccounts,
} from "../db";
import type { Account, ApportionRule, Direction, TaxCategory } from "../lib/types";
import { TAX_CATEGORIES } from "../lib/types";
import { applyMapping, dedupKeys, detectMapping, parseCsv, type CsvMapping } from "../lib/csv";
import { classify } from "../lib/classifier";
import { decryptJson, encryptJson, signToken, verifyToken } from "../lib/crypto";
import type { BankCredentials, BankProvider, BankTransaction } from "../lib/banks/types";
import { gmoAozoraProvider, gmoAuthorizeUrl, gmoExchangeCode, type GmoConfig } from "../lib/banks/gmoAozora";
import { learnStmt, linesFor, suggest } from "./journals";

export const bankRoutes = new Hono<AppEnv>();

interface BankAccountRow {
  id: number;
  name: string;
  kind: "bank" | "card" | "ewallet" | "cash";
  account_id: number;
  provider: string;
  provider_config: string | null;
  credentials: string | null;
  csv_mapping: string | null;
  last_synced_at: string | null;
  active: number;
}

interface BankTxRow {
  id: number;
  bank_account_id: number;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  status: string;
  journal_id: number | null;
}

function gmoConfig(env: Env, override?: { apiBase?: string }): GmoConfig {
  return {
    apiBase: override?.apiBase || env.GMO_AOZORA_API_BASE || "https://api.gmo-aozora.com/ganb/api/personal/v1",
    authBase: env.GMO_AOZORA_AUTH_BASE || "https://api.gmo-aozora.com/ganb/api/auth/v1",
    clientId: env.GMO_AOZORA_CLIENT_ID,
    clientSecret: env.GMO_AOZORA_CLIENT_SECRET,
  };
}

/** 対応している API プロバイダ。新しい銀行はここに追加する */
export function providerFor(env: Env, ba: BankAccountRow): BankProvider | null {
  const cfg = ba.provider_config ? (JSON.parse(ba.provider_config) as { api_base?: string }) : {};
  if (ba.provider === "gmo_aozora") return gmoAozoraProvider(gmoConfig(env, { apiBase: cfg.api_base }));
  return null;
}

function encKey(env: Env): string {
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 16) throw new HttpError(503, "ENCRYPTION_KEY が未設定です（README 参照）");
  return env.ENCRYPTION_KEY;
}

async function getBankAccount(db: D1Database, id: number): Promise<BankAccountRow> {
  const ba = await db.prepare("SELECT * FROM bank_accounts WHERE id = ?").bind(id).first<BankAccountRow>();
  if (!ba) throw new HttpError(404, "口座が見つかりません");
  return ba;
}

/** 明細を重複排除して登録 */
export async function insertTransactions(db: D1Database, bankAccountId: number, txs: Array<Omit<BankTransaction, "external_id"> & { external_id?: string | null }>): Promise<{ imported: number; duplicates: number }> {
  const keys = dedupKeys(bankAccountId, txs);
  let imported = 0;
  for (let i = 0; i < txs.length; i += 50) {
    const res = await db.batch(
      txs.slice(i, i + 50).map((t, k) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO bank_transactions (bank_account_id, date, description, amount, balance, external_id, dedup_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(bankAccountId, t.date, t.description.slice(0, 500), t.amount, t.balance, t.external_id ?? null, keys[i + k]),
      ),
    );
    imported += res.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  }
  return { imported, duplicates: txs.length - imported };
}

/** API 連携口座の明細取得（手動同期・Cron 共通） */
export async function syncBankAccount(env: Env, ba: BankAccountRow, from?: string, to?: string): Promise<{ imported: number; duplicates: number }> {
  const provider = providerFor(env, ba);
  if (!provider) throw new HttpError(400, "この口座は API 連携に対応していません");
  if (!ba.credentials) throw new HttpError(400, "API 連携の認証が未設定です");
  const cfg = ba.provider_config ? (JSON.parse(ba.provider_config) as { external_account_id?: string }) : {};
  if (!cfg.external_account_id) throw new HttpError(400, "連携する口座が未選択です");
  let cred = await decryptJson<BankCredentials>(ba.credentials, encKey(env));
  if (cred.expires_at && cred.expires_at < Date.now() + 60_000 && provider.refresh) {
    cred = await provider.refresh(cred);
    await env.DB.prepare("UPDATE bank_accounts SET credentials = ? WHERE id = ?").bind(await encryptJson(cred, encKey(env)), ba.id).run();
  }
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const start = from ?? (ba.last_synced_at ? new Date(Date.parse(ba.last_synced_at) - 7 * 86400_000).toISOString().slice(0, 10) : `${today.slice(0, 4)}-01-01`);
  const txs = await provider.fetchTransactions(cred, cfg.external_account_id, start, to ?? today);
  const r = await insertTransactions(env.DB, ba.id, txs);
  await env.DB.prepare("UPDATE bank_accounts SET last_synced_at = datetime('now') WHERE id = ?").bind(ba.id).run();
  return r;
}

// ---------- 口座 ----------
bankRoutes.get("/bank-accounts", async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.kind, b.account_id, b.provider, b.provider_config, b.csv_mapping, b.last_synced_at, b.active,
            b.credentials IS NOT NULL AS connected,
            (SELECT COUNT(*) FROM bank_transactions t WHERE t.bank_account_id = b.id AND t.status = 'unprocessed') AS unprocessed,
            (SELECT balance FROM bank_transactions t WHERE t.bank_account_id = b.id AND t.balance IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1) AS last_balance
       FROM bank_accounts b ORDER BY b.id`,
  ).all();
  return c.json(r.results);
});

bankRoutes.post("/bank-accounts", async (c) => {
  const b = await c.req.json<{ name: string; kind: BankAccountRow["kind"]; account_id?: number; provider?: string }>();
  if (!b.name?.trim()) throw new HttpError(400, "口座名は必須です");
  const kind = ["bank", "card", "ewallet", "cash"].includes(b.kind) ? b.kind : "bank";
  const sys = systemAccounts(await getAccounts(c.env.DB));
  const accountId = b.account_id || (kind === "card" ? sys.payable : kind === "cash" ? sys.cash : sys.bank);
  const provider = ["csv", "gmo_aozora", "manual"].includes(b.provider ?? "") ? b.provider : "csv";
  const r = await c.env.DB.prepare("INSERT INTO bank_accounts (name, kind, account_id, provider) VALUES (?, ?, ?, ?)").bind(b.name.trim(), kind, accountId, provider).run();
  return c.json({ id: r.meta.last_row_id });
});

bankRoutes.put("/bank-accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const ba = await getBankAccount(c.env.DB, id);
  const b = await c.req.json<{ name?: string; kind?: string; account_id?: number; provider?: string; provider_config?: Record<string, string>; active?: boolean }>();
  const cfg = { ...(ba.provider_config ? JSON.parse(ba.provider_config) : {}), ...(b.provider_config ?? {}) };
  if (cfg.api_base && !/^https:\/\//.test(cfg.api_base)) throw new HttpError(400, "API URL は https で指定してください");
  await c.env.DB.prepare("UPDATE bank_accounts SET name = ?, kind = ?, account_id = ?, provider = ?, provider_config = ?, active = ? WHERE id = ?")
    .bind(
      b.name?.trim() || ba.name,
      ["bank", "card", "ewallet", "cash"].includes(b.kind ?? "") ? b.kind : ba.kind,
      b.account_id || ba.account_id,
      ["csv", "gmo_aozora", "manual"].includes(b.provider ?? "") ? b.provider : ba.provider,
      JSON.stringify(cfg),
      b.active === undefined ? ba.active : b.active ? 1 : 0,
      id,
    )
    .run();
  return c.json({ ok: true });
});

bankRoutes.delete("/bank-accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM bank_transactions WHERE bank_account_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM bank_accounts WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- CSV 取込 ----------
bankRoutes.post("/bank-accounts/:id/csv/preview", async (c) => {
  const ba = await getBankAccount(c.env.DB, Number(c.req.param("id")));
  const { text, mapping } = await c.req.json<{ text: string; mapping?: CsvMapping }>();
  const rows = parseCsv(text ?? "");
  if (rows.length === 0) throw new HttpError(400, "CSV にデータがありません");
  const saved = ba.csv_mapping ? (JSON.parse(ba.csv_mapping) as CsvMapping) : null;
  const m = mapping ?? detectMapping(rows, ba.kind === "card") ?? saved;
  const parsed = m ? applyMapping(rows, m) : { transactions: [], errors: [] };
  return c.json({ rows: rows.slice(0, 20), row_count: rows.length, mapping: m, detected: !!m && !mapping, sample: parsed.transactions.slice(0, 50), count: parsed.transactions.length, errors: parsed.errors.slice(0, 20) });
});

bankRoutes.post("/bank-accounts/:id/csv/import", async (c) => {
  const ba = await getBankAccount(c.env.DB, Number(c.req.param("id")));
  const { text, mapping } = await c.req.json<{ text: string; mapping: CsvMapping }>();
  if (!mapping) throw new HttpError(400, "列の割り当てを指定してください");
  const { transactions, errors } = applyMapping(parseCsv(text ?? ""), mapping);
  if (transactions.length === 0) throw new HttpError(400, "取り込める明細がありません");
  const r = await insertTransactions(c.env.DB, ba.id, transactions);
  await c.env.DB.prepare("UPDATE bank_accounts SET csv_mapping = ?, last_synced_at = datetime('now') WHERE id = ?").bind(JSON.stringify(mapping), ba.id).run();
  return c.json({ ...r, errors: errors.length });
});

// ---------- API 連携 ----------
// sunabar（API実験場）等で発行されたアクセストークンを直接登録
bankRoutes.post("/bank-accounts/:id/token", async (c) => {
  const ba = await getBankAccount(c.env.DB, Number(c.req.param("id")));
  const b = await c.req.json<{ access_token: string }>();
  if (!b.access_token?.trim()) throw new HttpError(400, "アクセストークンを入力してください");
  const cred: BankCredentials = { access_token: b.access_token.trim() };
  await c.env.DB.prepare("UPDATE bank_accounts SET credentials = ? WHERE id = ?").bind(await encryptJson(cred, encKey(c.env)), ba.id).run();
  return c.json({ ok: true });
});

bankRoutes.delete("/bank-accounts/:id/token", async (c) => {
  await c.env.DB.prepare("UPDATE bank_accounts SET credentials = NULL WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

bankRoutes.get("/bank-accounts/:id/external-accounts", async (c) => {
  const ba = await getBankAccount(c.env.DB, Number(c.req.param("id")));
  const provider = providerFor(c.env, ba);
  if (!provider || !ba.credentials) throw new HttpError(400, "API 連携が未設定です");
  const cred = await decryptJson<BankCredentials>(ba.credentials, encKey(c.env));
  return c.json(await provider.listAccounts(cred));
});

bankRoutes.post("/bank-accounts/:id/sync", async (c) => {
  const ba = await getBankAccount(c.env.DB, Number(c.req.param("id")));
  const b = await c.req.json<{ from?: string; to?: string }>().catch(() => ({}) as { from?: string; to?: string });
  try {
    return c.json(await syncBankAccount(c.env, ba, b.from, b.to));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, (e as Error).message);
  }
});

// OAuth2 認可（GMOあおぞらネット銀行 本番 API）
bankRoutes.get("/bank/oauth/gmo/start", async (c) => {
  const id = Number(c.req.query("bank_account_id"));
  await getBankAccount(c.env.DB, id);
  const cfg = gmoConfig(c.env);
  if (!cfg.clientId || !cfg.clientSecret) throw new HttpError(400, "GMO_AOZORA_CLIENT_ID / GMO_AOZORA_CLIENT_SECRET が未設定です");
  const state = await signToken({ id, exp: Date.now() + 10 * 60_000 }, encKey(c.env));
  const redirect = new URL("/api/bank/oauth/gmo/callback", c.req.url).toString();
  return c.redirect(gmoAuthorizeUrl(cfg, redirect, state));
});

bankRoutes.get("/bank/oauth/gmo/callback", async (c) => {
  const { code, state, error } = c.req.query();
  if (error || !code || !state) return c.redirect("/#/bank?oauth=error");
  const s = await verifyToken<{ id: number; exp: number }>(state, encKey(c.env));
  if (!s || s.exp < Date.now()) return c.redirect("/#/bank?oauth=expired");
  const cfg = gmoConfig(c.env);
  const cred = await gmoExchangeCode(cfg, code, new URL("/api/bank/oauth/gmo/callback", c.req.url).toString());
  await c.env.DB.prepare("UPDATE bank_accounts SET credentials = ?, provider = 'gmo_aozora' WHERE id = ?").bind(await encryptJson(cred, encKey(c.env)), s.id).run();
  return c.redirect("/#/bank?oauth=ok");
});

// ---------- 明細 → 仕訳 ----------
bankRoutes.get("/bank-transactions", async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status) (where.push("t.status = ?"), binds.push(q.status));
  if (q.bank_account_id) (where.push("t.bank_account_id = ?"), binds.push(Number(q.bank_account_id)));
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const r = await c.env.DB.prepare(
    `SELECT t.*, b.name AS bank_name, b.account_id AS bank_ledger_account_id FROM bank_transactions t JOIN bank_accounts b ON b.id = t.bank_account_id ${w}
     ORDER BY t.date DESC, t.id DESC LIMIT ?`,
  )
    .bind(...binds, Math.min(Number(q.limit) || 300, 1000))
    .all<BankTxRow & { bank_name: string }>();
  const [accounts, rules] = await Promise.all([getAccounts(c.env.DB), getRules(c.env.DB)]);
  return c.json(
    r.results.map((t) => ({
      ...t,
      suggestion: t.status === "unprocessed" ? classify(t.description, t.amount > 0 ? "income" : "expense", rules, accounts) : null,
    })),
  );
});

async function journalizeTx(
  env: Env,
  tx: BankTxRow,
  ctx: { accounts: Account[]; apportion: ApportionRule[]; bankLedgerId: number },
  p: { account_id: number; tax_category: TaxCategory; description?: string; partner?: string | null; learn?: boolean; receipt_ids?: number[] },
): Promise<number> {
  if (tx.status !== "unprocessed") throw new HttpError(409, "この明細は処理済みです");
  const direction: Direction = tx.amount > 0 ? "income" : "expense";
  const acc = ctx.accounts.find((a) => a.id === p.account_id);
  if (!acc) throw new HttpError(400, "勘定科目が不正です");
  const isPL = acc.category === "revenue" || acc.category === "expense";
  const { lines } = linesFor(ctx.accounts, ctx.apportion, {
    direction,
    amount: Math.abs(tx.amount),
    account_id: p.account_id,
    counter_account_id: ctx.bankLedgerId,
    tax_category: isPL ? p.tax_category : "out",
  });
  const extra: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE bank_transactions SET status = 'journaled', journal_id = ${NEW_JOURNAL_ID} WHERE id = ?`).bind(tx.id),
  ];
  if (p.learn !== false) {
    const s = learnStmt(env.DB, tx.description, direction, p.account_id, isPL ? p.tax_category : "out", p.partner ?? null);
    if (s) extra.push(s);
  }
  for (const rid of p.receipt_ids ?? []) extra.push(env.DB.prepare(`UPDATE receipts SET journal_id = ${NEW_JOURNAL_ID} WHERE id = ?`).bind(Number(rid)));
  return insertJournal(
    env.DB,
    { date: tx.date, description: p.description?.trim() || tx.description, partner: p.partner ?? null, source: "bank", source_ref: String(tx.id), lines },
    extra,
  );
}

async function loadTx(db: D1Database, id: number): Promise<BankTxRow & { bank_ledger_account_id: number }> {
  const tx = await db
    .prepare("SELECT t.*, b.account_id AS bank_ledger_account_id FROM bank_transactions t JOIN bank_accounts b ON b.id = t.bank_account_id WHERE t.id = ?")
    .bind(id)
    .first<BankTxRow & { bank_ledger_account_id: number }>();
  if (!tx) throw new HttpError(404, "明細が見つかりません");
  return tx;
}

bankRoutes.post("/bank-transactions/:id/journal", async (c) => {
  const tx = await loadTx(c.env.DB, Number(c.req.param("id")));
  const b = await c.req.json<{ account_id: number; tax_category?: TaxCategory; description?: string; partner?: string; learn?: boolean; receipt_ids?: number[] }>();
  const [accounts, apportion] = await Promise.all([getAccounts(c.env.DB), getApportionRules(c.env.DB)]);
  const acc = accounts.find((a) => a.id === Number(b.account_id));
  const tax = TAX_CATEGORIES.includes(b.tax_category as TaxCategory) ? b.tax_category! : acc?.tax_default ?? "out";
  const id = await journalizeTx(c.env, tx, { accounts, apportion, bankLedgerId: tx.bank_ledger_account_id }, { ...b, account_id: Number(b.account_id), tax_category: tax });
  return c.json({ id });
});

bankRoutes.post("/bank-transactions/:id/ai-suggest", async (c) => {
  const tx = await loadTx(c.env.DB, Number(c.req.param("id")));
  return c.json(await suggest(c.env, tx.description, tx.amount > 0 ? "income" : "expense", Math.abs(tx.amount), { aiEnabled: true }));
});

/** 推定の確度が高い明細をまとめて仕訳化 */
bankRoutes.post("/bank-transactions/auto", async (c) => {
  const b = await c.req.json<{ ids?: number[]; min_confidence?: number }>().catch(() => ({}) as { ids?: number[]; min_confidence?: number });
  const min = b.min_confidence ?? 0.8;
  const [accounts, rules, apportion] = await Promise.all([getAccounts(c.env.DB), getRules(c.env.DB), getApportionRules(c.env.DB)]);
  const r = await c.env.DB.prepare(
    "SELECT t.*, b.account_id AS bank_ledger_account_id FROM bank_transactions t JOIN bank_accounts b ON b.id = t.bank_account_id WHERE t.status = 'unprocessed' ORDER BY t.date LIMIT 500",
  ).all<BankTxRow & { bank_ledger_account_id: number }>();
  const targets = b.ids ? r.results.filter((t) => b.ids!.includes(t.id)) : r.results;
  let done = 0;
  const skipped: number[] = [];
  for (const tx of targets) {
    const s = classify(tx.description, tx.amount > 0 ? "income" : "expense", rules, accounts);
    if (s.confidence < min) {
      skipped.push(tx.id);
      continue;
    }
    try {
      await journalizeTx(c.env, tx, { accounts, apportion, bankLedgerId: tx.bank_ledger_account_id }, { account_id: s.account_id, tax_category: s.tax_category, partner: s.partner, learn: true });
      done++;
    } catch {
      skipped.push(tx.id);
    }
  }
  return c.json({ journaled: done, skipped: skipped.length });
});

bankRoutes.post("/bank-transactions/:id/status", async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  if (!["ignored", "unprocessed"].includes(status)) throw new HttpError(400, "状態が不正です");
  await c.env.DB.prepare("UPDATE bank_transactions SET status = ? WHERE id = ? AND status <> 'journaled'").bind(status, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// 手入力の明細（現金出納帳・API未対応の電子マネー等）
bankRoutes.post("/bank-accounts/:id/transactions", async (c) => {
  const ba = await getBankAccount(c.env.DB, Number(c.req.param("id")));
  const b = await c.req.json<{ date: string; description: string; amount: number }>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isInteger(Number(b.amount)) || Number(b.amount) === 0) throw new HttpError(400, "入力内容が不正です");
  const r = await insertTransactions(c.env.DB, ba.id, [{ date: b.date, description: b.description || "(摘要なし)", amount: Number(b.amount), balance: null, external_id: `manual-${Date.now()}` }]);
  return c.json(r);
});
