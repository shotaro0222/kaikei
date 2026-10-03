import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { HttpError, getAccounts, getMovements, getOpening, getSettings, getYearInputs, parseYear, systemAccounts, yearRange } from "../db";
import { buildBalanceSheet, buildBalances, buildProfitAndLoss, EXPENSE_LINES } from "../lib/reports";
import { computeDepreciation, straightLineRate, type FixedAsset } from "../lib/depreciation";
import { calcIncomeTax, type Deductions } from "../lib/incomeTax";
import { calcConsumptionTax, emptyBuckets, type ConsumptionMethod } from "../lib/consumptionTax";
import { isDebitNormal, isValidDate, type TaxCategory } from "../lib/types";

export const reportRoutes = new Hono<AppEnv>();

function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
}

/** 期間 [from, to]（同一年内）の科目残高。期首は年初残高 + 年初〜from前日の増減 */
async function periodBalances(env: Env, from: string, to: string) {
  const year = Number(from.slice(0, 4));
  const accounts = await getAccounts(env.DB);
  const opening = await getOpening(env.DB, year);
  if (from > `${year}-01-01`) {
    const pre = await getMovements(env.DB, `${year}-01-01`, addDays(from, -1));
    for (const a of accounts) {
      if (a.category === "revenue" || a.category === "expense") continue;
      const m = pre.get(a.id);
      if (!m) continue;
      const delta = isDebitNormal(a.category) ? m.debit - m.credit : m.credit - m.debit;
      opening.set(a.id, (opening.get(a.id) ?? 0) + delta);
    }
  }
  const mv = await getMovements(env.DB, from, to);
  return { accounts, balances: buildBalances(accounts, opening, mv) };
}

export async function yearStatements(env: Env, year: number) {
  const { from, to } = yearRange(year);
  const [{ accounts, balances }, settings] = await Promise.all([periodBalances(env, from, to), getSettings(env.DB)]);
  const blueLimit = settings.filing_type === "blue" ? Number(settings.blue_deduction) || 0 : 0;
  const pl = buildProfitAndLoss(balances, blueLimit);
  const bs = buildBalanceSheet(balances, pl.income_before_deduction);
  return { accounts, balances, pl, bs, settings };
}

function rangeParams(q: Record<string, string>): { from: string; to: string } {
  const year = Number(q.year) || new Date().getFullYear();
  const from = q.from && isValidDate(q.from) ? q.from : `${year}-01-01`;
  const to = q.to && isValidDate(q.to) ? q.to : `${from.slice(0, 4)}-12-31`;
  if (from.slice(0, 4) !== to.slice(0, 4)) throw new HttpError(400, "期間は同じ年の中で指定してください");
  if (from > to) throw new HttpError(400, "期間の指定が不正です");
  return { from, to };
}

reportRoutes.get("/reports/trial-balance", async (c) => {
  const { from, to } = rangeParams(c.req.query());
  const { balances } = await periodBalances(c.env, from, to);
  return c.json(
    balances
      .filter((b) => b.opening || b.debit || b.credit || b.closing)
      .map((b) => ({ account_id: b.account.id, code: b.account.code, name: b.account.name, category: b.account.category, opening: b.opening, debit: b.debit, credit: b.credit, closing: b.closing })),
  );
});

reportRoutes.get("/reports/ledger", async (c) => {
  const q = c.req.query();
  const { from, to } = rangeParams(q);
  const accountId = Number(q.account_id);
  const { balances } = await periodBalances(c.env, from, to);
  const bal = balances.find((b) => b.account.id === accountId);
  if (!bal) throw new HttpError(404, "勘定科目が見つかりません");
  const r = await c.env.DB.prepare(
    `SELECT j.id AS journal_id, j.date, j.description, j.partner, l.side, l.amount, l.tax_category,
            (SELECT GROUP_CONCAT(a.name, '・') FROM journal_lines o JOIN accounts a ON a.id = o.account_id
              WHERE o.journal_id = j.id AND o.side <> l.side) AS counter
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id
      WHERE l.account_id = ? AND j.date BETWEEN ? AND ?
      ORDER BY j.date, j.id, l.id`,
  )
    .bind(accountId, from, to)
    .all<{ journal_id: number; date: string; description: string; partner: string | null; side: string; amount: number; tax_category: TaxCategory; counter: string }>();
  const debitNormal = isDebitNormal(bal.account.category);
  let running = bal.opening;
  const rows = r.results.map((x) => {
    const debit = x.side === "debit" ? x.amount : 0;
    const credit = x.side === "credit" ? x.amount : 0;
    running += debitNormal ? debit - credit : credit - debit;
    return { ...x, debit, credit, balance: running };
  });
  return c.json({ account: bal.account, opening: bal.opening, rows, closing: bal.closing });
});

async function monthly(env: Env, year: number) {
  const { from, to } = yearRange(year);
  const r = await env.DB.prepare(
    `SELECT substr(j.date, 6, 2) AS m, a.category, a.report_line,
            SUM(CASE WHEN l.side = 'credit' THEN l.amount ELSE -l.amount END) AS credit_net
       FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
      WHERE j.date BETWEEN ? AND ? AND a.category IN ('revenue', 'expense')
      GROUP BY m, a.category, a.report_line`,
  )
    .bind(from, to)
    .all<{ m: string; category: string; report_line: string | null; credit_net: number }>();
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, sales: 0, misc_income: 0, purchases: 0, revenue: 0, expense: 0, profit: 0 }));
  for (const x of r.results) {
    const row = months[Number(x.m) - 1];
    if (x.category === "revenue") {
      row.revenue += x.credit_net;
      if (x.report_line === "sales") row.sales += x.credit_net;
      else row.misc_income += x.credit_net;
    } else {
      row.expense -= x.credit_net;
      if (x.report_line === "purchases") row.purchases -= x.credit_net;
    }
  }
  for (const m of months) m.profit = m.revenue - m.expense;
  return months;
}

reportRoutes.get("/reports/monthly", async (c) => c.json(await monthly(c.env, parseYear(c.req.query("year")))));

reportRoutes.get("/reports/statements", async (c) => {
  const { pl, bs } = await yearStatements(c.env, parseYear(c.req.query("year")));
  return c.json({ pl, bs });
});

reportRoutes.get("/reports/dashboard", async (c) => {
  const year = parseYear(c.req.query("year"));
  const db = c.env.DB;
  const [{ pl, balances }, months, counts] = await Promise.all([
    yearStatements(c.env, year),
    monthly(c.env, year),
    db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE status = 'unprocessed'"),
      db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE deleted_at IS NULL AND journal_id IS NULL"),
      db.prepare("SELECT COUNT(*) AS n FROM journals WHERE date BETWEEN ? AND ?").bind(`${year}-01-01`, `${year}-12-31`),
    ]),
  ]);
  const n = (i: number) => (counts[i].results[0] as { n: number }).n;
  const cashLike = balances.filter((b) => ["現金", "普通預金", "当座預金", "定期預金"].includes(b.account.name)).map((b) => ({ name: b.account.name, balance: b.closing }));
  const topExpenses = balances
    .filter((b) => b.account.category === "expense" && b.closing > 0)
    .sort((a, b) => b.closing - a.closing)
    .slice(0, 8)
    .map((b) => ({ name: b.account.name, amount: b.closing }));
  return c.json({
    year,
    sales: pl.sales,
    expenses: pl.total_expenses + pl.cost_of_sales,
    income_before_deduction: pl.income_before_deduction,
    income: pl.income,
    months,
    cash: cashLike,
    top_expenses: topExpenses,
    unprocessed_bank: n(0),
    unlinked_receipts: n(1),
    journal_count: n(2),
  });
});

// ---------- 確定申告 ----------
async function depreciationRows(env: Env, year: number) {
  const accounts = await getAccounts(env.DB);
  const r = await env.DB.prepare("SELECT * FROM fixed_assets ORDER BY acquisition_date, id").all<FixedAsset>();
  return r.results
    .map((a) => {
      const d = computeDepreciation(a, year);
      return {
        name: a.name,
        account: accounts.find((x) => x.id === a.account_id)?.name ?? "",
        quantity: a.quantity,
        acquisition: a.service_date || a.acquisition_date,
        cost: a.acquisition_cost,
        base: a.acquisition_cost, // 償却の基礎になる金額
        method: a.method === "straight_line" ? "定額法" : a.method === "lump_sum" ? "一括償却" : "少額特例",
        life: a.method === "straight_line" ? a.useful_life : a.method === "lump_sum" ? 3 : null,
        rate: a.method === "straight_line" ? straightLineRate(a.useful_life) : a.method === "lump_sum" ? "1/3" : null,
        months: d.months,
        depreciation: d.depreciation,
        business_ratio: a.business_ratio,
        business_amount: d.business_amount,
        closing_book: d.closing_book,
        opening_book: d.opening_book,
        year_matches: d.year === year,
      };
    })
    .filter((x) => x.year_matches && (x.depreciation > 0 || x.closing_book > 0 || x.opening_book > 0));
}

/** 決算書2ページの内訳（支払先別）。家事按分の振替は行に出さず「必要経費算入額」に比例配分する */
async function breakdown(env: Env, year: number, reportLine: string) {
  const [rows, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COALESCE(NULLIF(j.partner, ''), j.description) AS partner,
              SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END) AS amount
         FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE a.report_line = ? AND j.date BETWEEN ? AND ? AND j.source <> 'apportion'
        GROUP BY 1 HAVING amount <> 0 ORDER BY amount DESC LIMIT 20`,
    ).bind(reportLine, `${year}-01-01`, `${year}-12-31`),
    env.DB.prepare(
      `SELECT SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END) AS net,
              SUM(CASE WHEN j.source <> 'apportion' THEN CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END ELSE 0 END) AS gross
         FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE a.report_line = ? AND j.date BETWEEN ? AND ?`,
    ).bind(reportLine, `${year}-01-01`, `${year}-12-31`),
  ]);
  const t = total.results[0] as { net: number | null; gross: number | null };
  const ratio = t.gross ? (t.net ?? 0) / t.gross : 1;
  return (rows.results as Array<{ partner: string; amount: number }>).map((r) => ({ ...r, business: Math.round(r.amount * ratio) }));
}

reportRoutes.get("/tax/:year/statement", async (c) => {
  const year = parseYear(c.req.param("year"));
  const [{ pl, bs, settings }, months, depreciation, rent, wages, outsourcing] = await Promise.all([
    yearStatements(c.env, year),
    monthly(c.env, year),
    depreciationRows(c.env, year),
    breakdown(c.env, year, "rent"),
    breakdown(c.env, year, "wages"),
    breakdown(c.env, year, "outsourcing"),
  ]);
  return c.json({ year, settings, pl, bs, months, depreciation, rent, wages, outsourcing, expense_lines: EXPENSE_LINES });
});

const INPUT_KEYS = [
  "social_insurance", "small_business_mutual", "life_insurance", "earthquake_insurance", "medical", "donation", "spouse", "dependents", "other",
  "basic_override", "salary_income", "misc_income", "other_income", "withholding", "prepaid", "notes",
];

reportRoutes.get("/tax/:year/inputs", async (c) => c.json(await getYearInputs(c.env.DB, parseYear(c.req.param("year")))));

reportRoutes.put("/tax/:year/inputs", async (c) => {
  const year = parseYear(c.req.param("year"));
  const b = await c.req.json<Record<string, string | number | null>>();
  const stmts = Object.entries(b)
    .filter(([k]) => INPUT_KEYS.includes(k))
    .map(([k, v]) =>
      v === null || v === ""
        ? c.env.DB.prepare("DELETE FROM year_inputs WHERE fiscal_year = ? AND key = ?").bind(year, k)
        : c.env.DB.prepare("INSERT INTO year_inputs (fiscal_year, key, value) VALUES (?, ?, ?) ON CONFLICT(fiscal_year, key) DO UPDATE SET value = excluded.value").bind(year, k, String(v)),
    );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

reportRoutes.get("/tax/:year/income", async (c) => {
  const year = parseYear(c.req.param("year"));
  const [{ pl, settings }, inputs] = await Promise.all([yearStatements(c.env, year), getYearInputs(c.env.DB, year)]);
  const n = (k: string) => Math.max(0, Math.round(Number(inputs[k] ?? 0) || 0));
  const deductions: Deductions = {
    social_insurance: n("social_insurance"),
    small_business_mutual: n("small_business_mutual"),
    life_insurance: n("life_insurance"),
    earthquake_insurance: n("earthquake_insurance"),
    medical: n("medical"),
    donation: n("donation"),
    spouse: n("spouse"),
    dependents: n("dependents"),
    other: n("other"),
    basic_override: inputs.basic_override != null && inputs.basic_override !== "" ? n("basic_override") : null,
  };
  const result = calcIncomeTax({
    year,
    business_income: pl.income,
    other: { salary_income: n("salary_income"), misc_income: n("misc_income"), other_income: n("other_income") },
    deductions,
    withholding: n("withholding"),
    prepaid: n("prepaid"),
  });
  return c.json({ year, filing_type: settings.filing_type, business_sales: pl.sales, business_income: pl.income, blue_deduction: pl.blue_deduction, deductions, inputs, result });
});

reportRoutes.get("/tax/:year/consumption", async (c) => {
  const year = parseYear(c.req.param("year"));
  const { from, to } = yearRange(year);
  const [settings, r] = await Promise.all([
    getSettings(c.env.DB),
    c.env.DB.prepare(
      `SELECT a.category, l.tax_category, SUM(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END) AS debit_net
         FROM journal_lines l JOIN journals j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE j.date BETWEEN ? AND ? AND l.tax_category <> 'out'
        GROUP BY a.category, l.tax_category`,
    )
      .bind(from, to)
      .all<{ category: string; tax_category: TaxCategory; debit_net: number }>(),
  ]);
  const buckets = emptyBuckets();
  for (const x of r.results) {
    if (x.category === "revenue") buckets.sales[x.tax_category] += -x.debit_net;
    else if (x.category === "expense" || x.category === "asset") buckets.purchases[x.tax_category] += x.debit_net;
  }
  const method = (settings.consumption_tax || "exempt") as ConsumptionMethod;
  const result = calcConsumptionTax(buckets, method, Number(settings.simplified_category) || 5);
  // 基準期間の課税売上高（2年前）が1,000万円超なら課税事業者
  const prev = await yearStatements(c.env, year - 2).catch(() => null);
  return c.json({ year, buckets, result, method, base_period_sales: prev?.pl.sales ?? null });
});

// ---------- エクスポート ----------
function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const TAX_LABEL: Record<string, string> = { taxable10: "課税10%", taxable8: "課税8%(軽減)", exempt: "非課税", out: "対象外", export: "輸出免税" };

reportRoutes.get("/export/journals.csv", async (c) => {
  const year = parseYear(c.req.query("year"));
  const r = await c.env.DB.prepare(
    `SELECT j.id, j.date, j.description, j.partner, j.memo, j.source, l.side, a.code, a.name, l.amount, l.tax_category, l.memo AS line_memo
       FROM journals j JOIN journal_lines l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id
      WHERE j.date BETWEEN ? AND ? ORDER BY j.date, j.id, l.side DESC, l.id`,
  )
    .bind(`${year}-01-01`, `${year}-12-31`)
    .all<Record<string, string | number>>();
  const header = ["伝票番号", "日付", "借貸", "科目コード", "勘定科目", "金額", "税区分", "摘要", "取引先", "行メモ", "仕訳メモ", "入力元"];
  const lines = r.results.map((x) =>
    [x.id, x.date, x.side === "debit" ? "借方" : "貸方", x.code, x.name, x.amount, TAX_LABEL[String(x.tax_category)] ?? x.tax_category, x.description, x.partner, x.line_memo, x.memo, x.source].map(csvEscape).join(","),
  );
  return new Response("﻿" + [header.join(","), ...lines].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journals-${year}.csv"` },
  });
});

export async function backupJson(env: Env): Promise<string> {
  const tables = ["settings", "accounts", "journals", "journal_lines", "classification_rules", "apportion_rules", "receipts", "bank_accounts", "bank_transactions", "fixed_assets", "opening_balances", "year_inputs", "audit_log"];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const r = await env.DB.prepare(`SELECT * FROM ${t}`).all();
    out[t] = t === "bank_accounts" ? r.results.map((x) => ({ ...x, credentials: null })) : r.results;
  }
  return JSON.stringify({ app: "kaikei", version: 1, exported_at: new Date().toISOString(), tables: out });
}

reportRoutes.get("/export/backup.json", async (c) =>
  new Response(await backupJson(c.env), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="kaikei-backup-${new Date().toISOString().slice(0, 10)}.json"` },
  }),
);

reportRoutes.get("/system-check", async (c) => {
  const accounts = await getAccounts(c.env.DB);
  systemAccounts(accounts);
  return c.json({
    ai: !!c.env.AI,
    r2: !!c.env.RECEIPTS,
    encryption: !!c.env.ENCRYPTION_KEY && c.env.ENCRYPTION_KEY.length >= 16,
    gmo_oauth: !!(c.env.GMO_AOZORA_CLIENT_ID && c.env.GMO_AOZORA_CLIENT_SECRET),
  });
});
