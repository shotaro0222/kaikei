import type { Account, ApportionRule, ClassificationRule, JournalInput, LineInput } from "./lib/types";
import { validateLines } from "./lib/journal";
import { isValidDate, TAX_CATEGORIES } from "./lib/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getAccounts(db: D1Database): Promise<Account[]> {
  const r = await db.prepare("SELECT * FROM accounts ORDER BY sort_order, code").all<Account>();
  return r.results;
}

export interface SystemAccounts {
  cash: number;
  bank: number;
  receivable: number;
  payable: number;
  ownerDraw: number;
  ownerContrib: number;
  capital: number;
  sales: number;
  depreciation: number;
  inventory: number;
  openingInventory: number;
  closingInventory: number;
}

const SYSTEM_NAMES: Record<keyof SystemAccounts, string> = {
  cash: "現金",
  bank: "普通預金",
  receivable: "売掛金",
  payable: "未払金",
  ownerDraw: "事業主貸",
  ownerContrib: "事業主借",
  capital: "元入金",
  sales: "売上高",
  depreciation: "減価償却費",
  inventory: "商品",
  openingInventory: "期首商品棚卸高",
  closingInventory: "期末商品棚卸高",
};

export function systemAccounts(accounts: Account[]): SystemAccounts {
  const out = {} as SystemAccounts;
  for (const [k, name] of Object.entries(SYSTEM_NAMES) as Array<[keyof SystemAccounts, string]>) {
    const a = accounts.find((x) => x.name === name);
    if (!a) throw new HttpError(500, `必須の勘定科目「${name}」がありません`);
    out[k] = a.id;
  }
  return out;
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const r = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return Object.fromEntries(r.results.map((x) => [x.key, x.value]));
}

export async function getYearInputs(db: D1Database, year: number): Promise<Record<string, string>> {
  const r = await db.prepare("SELECT key, value FROM year_inputs WHERE fiscal_year = ?").bind(year).all<{ key: string; value: string }>();
  return Object.fromEntries(r.results.map((x) => [x.key, x.value]));
}

export async function getRules(db: D1Database): Promise<ClassificationRule[]> {
  return (await db.prepare("SELECT * FROM classification_rules").all<ClassificationRule>()).results;
}

export async function getApportionRules(db: D1Database): Promise<ApportionRule[]> {
  return (await db.prepare("SELECT * FROM apportion_rules").all<ApportionRule>()).results;
}

/** 入力の検証と正規化 */
export function normalizeJournal(input: JournalInput, accounts: Account[]): JournalInput {
  if (!isValidDate(input.date)) throw new HttpError(400, "日付が不正です");
  const ids = new Set(accounts.map((a) => a.id));
  const lines: LineInput[] = (input.lines ?? [])
    .map((l) => ({
      side: l.side,
      account_id: Number(l.account_id),
      amount: Number(l.amount),
      tax_category: TAX_CATEGORIES.includes(l.tax_category as never) ? l.tax_category : "out",
      memo: l.memo ?? null,
    }))
    .filter((l) => l.amount !== 0);
  const err = validateLines(lines);
  if (err) throw new HttpError(400, err);
  for (const l of lines) if (!ids.has(l.account_id)) throw new HttpError(400, "存在しない勘定科目が指定されています");
  return {
    date: input.date,
    description: String(input.description ?? "").slice(0, 500),
    partner: input.partner ? String(input.partner).slice(0, 200) : null,
    memo: input.memo ? String(input.memo).slice(0, 2000) : null,
    source: input.source ?? "manual",
    source_ref: input.source_ref ?? null,
    lines,
  };
}

function lineStmts(db: D1Database, journalIdSql: string, journalIdBind: number[], lines: LineInput[]): D1PreparedStatement[] {
  return lines.map((l) =>
    db
      .prepare(`INSERT INTO journal_lines (journal_id, side, account_id, amount, tax_category, memo) VALUES (${journalIdSql}, ?, ?, ?, ?, ?)`)
      .bind(...journalIdBind, l.side, l.account_id, l.amount, l.tax_category ?? "out", l.memo ?? null),
  );
}

function auditStmt(db: D1Database, action: string, entity: string, idSql: string, idBind: number[], before: unknown, after: unknown): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO audit_log (action, entity, entity_id, before_json, after_json) VALUES (?, ?, ${idSql}, ?, ?)`)
    .bind(action, entity, ...idBind, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));
}

/**
 * 仕訳の登録（ヘッダ・明細・履歴を 1 トランザクションで）。
 * D1 の batch はトランザクションとして実行されるため、明細の journal_id は MAX(id) で参照する。
 */
export const NEW_JOURNAL_ID = "(SELECT MAX(id) FROM journals)";

export async function insertJournal(db: D1Database, j: JournalInput, extra: D1PreparedStatement[] = []): Promise<number> {
  const idSql = NEW_JOURNAL_ID;
  const res = await db.batch([
    db
      .prepare("INSERT INTO journals (date, description, partner, memo, source, source_ref) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(j.date, j.description, j.partner ?? null, j.memo ?? null, j.source ?? "manual", j.source_ref ?? null),
    ...lineStmts(db, idSql, [], j.lines),
    auditStmt(db, "create", "journal", idSql, [], null, j),
    ...extra,
  ]);
  return Number(res[0].meta.last_row_id);
}

export async function updateJournal(db: D1Database, id: number, j: JournalInput, before: unknown): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE journals SET date = ?, description = ?, partner = ?, memo = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(j.date, j.description, j.partner ?? null, j.memo ?? null, id),
    db.prepare("DELETE FROM journal_lines WHERE journal_id = ?").bind(id),
    ...lineStmts(db, "?", [id], j.lines),
    auditStmt(db, "update", "journal", "?", [id], before, j),
  ]);
}

export function deleteJournalStmts(db: D1Database, id: number, before: unknown): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE bank_transactions SET status = 'unprocessed', journal_id = NULL WHERE journal_id = ?").bind(id),
    db.prepare("UPDATE receipts SET journal_id = NULL WHERE journal_id = ?").bind(id),
    db.prepare("DELETE FROM journal_lines WHERE journal_id = ?").bind(id),
    db.prepare("DELETE FROM journals WHERE id = ?").bind(id),
    auditStmt(db, "delete", "journal", "?", [id], before, null),
  ];
}

export interface JournalWithLines {
  id: number;
  date: string;
  description: string;
  partner: string | null;
  memo: string | null;
  source: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
  lines: Array<LineInput & { id: number }>;
  receipts?: Array<{ id: number; file_name: string }>;
}

export async function loadJournals(db: D1Database, ids: number[]): Promise<JournalWithLines[]> {
  if (ids.length === 0) return [];
  const out: JournalWithLines[] = [];
  // D1 のバインド変数上限を考慮して分割
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const ph = chunk.map(() => "?").join(",");
    const [js, ls, rs] = await db.batch([
      db.prepare(`SELECT * FROM journals WHERE id IN (${ph})`).bind(...chunk),
      db.prepare(`SELECT * FROM journal_lines WHERE journal_id IN (${ph}) ORDER BY id`).bind(...chunk),
      db.prepare(`SELECT id, file_name, journal_id FROM receipts WHERE deleted_at IS NULL AND journal_id IN (${ph})`).bind(...chunk),
    ]);
    const lines = ls.results as Array<LineInput & { id: number; journal_id: number }>;
    const receipts = rs.results as Array<{ id: number; file_name: string; journal_id: number }>;
    for (const j of js.results as unknown as JournalWithLines[]) {
      out.push({
        ...j,
        lines: lines.filter((l) => l.journal_id === j.id),
        receipts: receipts.filter((r) => r.journal_id === j.id).map(({ id, file_name }) => ({ id, file_name })),
      });
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** 期間内の科目別 借方・貸方合計 */
export async function getMovements(
  db: D1Database,
  from: string,
  to: string,
  opts: { excludeSource?: string } = {},
): Promise<Map<number, { debit: number; credit: number }>> {
  const r = await db
    .prepare(
      `SELECT l.account_id,
              SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE 0 END) AS debit,
              SUM(CASE WHEN l.side = 'credit' THEN l.amount ELSE 0 END) AS credit
         FROM journal_lines l JOIN journals j ON j.id = l.journal_id
        WHERE j.date BETWEEN ? AND ? ${opts.excludeSource ? "AND j.source <> ?" : ""}
        GROUP BY l.account_id`,
    )
    .bind(...[from, to, ...(opts.excludeSource ? [opts.excludeSource] : [])])
    .all<{ account_id: number; debit: number; credit: number }>();
  return new Map(r.results.map((x) => [x.account_id, { debit: x.debit, credit: x.credit }]));
}

export async function getOpening(db: D1Database, year: number): Promise<Map<number, number>> {
  const r = await db.prepare("SELECT account_id, amount FROM opening_balances WHERE fiscal_year = ?").bind(year).all<{ account_id: number; amount: number }>();
  return new Map(r.results.map((x) => [x.account_id, x.amount]));
}

export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function parseYear(v: string | undefined): number {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new HttpError(400, "年度が不正です");
  return y;
}
