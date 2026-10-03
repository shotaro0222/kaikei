import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import {
  HttpError, deleteJournalStmts, getAccounts, getApportionRules, getMovements, getOpening, getSettings, insertJournal,
  loadJournals, parseYear, systemAccounts, yearRange,
} from "../db";
import { computeDepreciation, type FixedAsset } from "../lib/depreciation";
import { yearEndApportion } from "../lib/apportion";
import { buildBalances, buildProfitAndLoss, carryForward } from "../lib/reports";
import type { LineInput } from "../lib/types";

export const closingRoutes = new Hono<AppEnv>();

async function removeGenerated(db: D1Database, source: string, refLike: string) {
  const r = await db.prepare("SELECT id FROM journals WHERE source = ? AND source_ref LIKE ?").bind(source, refLike).all<{ id: number }>();
  const ids = r.results.map((x) => x.id);
  const js = await loadJournals(db, ids);
  const stmts = js.flatMap((j) => deleteJournalStmts(db, j.id, j));
  if (stmts.length) await db.batch(stmts);
}

async function depreciationPlan(db: D1Database, year: number) {
  const r = await db.prepare("SELECT * FROM fixed_assets ORDER BY acquisition_date, id").all<FixedAsset>();
  return r.results.map((a) => ({ asset: a, result: computeDepreciation(a, year) })).filter((x) => x.result.year === year && x.result.depreciation > 0);
}

async function apportionPlan(env: Env, year: number) {
  const { from, to } = yearRange(year);
  const [accounts, rules, mv] = await Promise.all([getAccounts(env.DB), getApportionRules(env.DB), getMovements(env.DB, from, to, { excludeSource: "apportion" })]);
  const totals = new Map<number, number>();
  for (const [id, m] of mv) totals.set(id, m.debit - m.credit);
  const sys = systemAccounts(accounts);
  const taxOf = (id: number) => accounts.find((a) => a.id === id)?.tax_default ?? "out";
  return { accounts, plan: yearEndApportion(totals, rules, sys.ownerDraw, taxOf), sys };
}

closingRoutes.get("/closing/:year", async (c) => {
  const year = parseYear(c.req.param("year"));
  const db = c.env.DB;
  const [dep, ap, gen, nextOpening] = await Promise.all([
    depreciationPlan(db, year),
    apportionPlan(c.env, year),
    db.prepare("SELECT source, COUNT(*) AS n, MAX(updated_at) AS at FROM journals WHERE source IN ('depreciation','apportion','inventory') AND source_ref LIKE ? GROUP BY source").bind(`${year}:%`).all(),
    db.prepare("SELECT COUNT(*) AS n FROM opening_balances WHERE fiscal_year = ?").bind(year + 1).first<{ n: number }>(),
  ]);
  const inv = await db
    .prepare("SELECT l.amount FROM journals j JOIN journal_lines l ON l.journal_id = j.id WHERE j.source = 'inventory' AND j.source_ref = ? AND l.side = 'debit'")
    .bind(`${year}:closing`)
    .first<{ amount: number }>();
  return c.json({
    depreciation: dep,
    apportion: ap.plan.map((p) => ({ ...p, account_name: ap.accounts.find((a) => a.id === p.account_id)?.name })),
    generated: gen.results,
    closing_inventory: inv?.amount ?? null,
    next_year_opening: (nextOpening?.n ?? 0) > 0,
  });
});

closingRoutes.post("/closing/:year/depreciation", async (c) => {
  const year = parseYear(c.req.param("year"));
  const accounts = await getAccounts(c.env.DB);
  const sys = systemAccounts(accounts);
  const plan = await depreciationPlan(c.env.DB, year);
  await removeGenerated(c.env.DB, "depreciation", `${year}:%`);
  for (const { asset, result } of plan) {
    const priv = result.depreciation - result.business_amount;
    const lines: LineInput[] = [];
    if (result.business_amount > 0) lines.push({ side: "debit", account_id: sys.depreciation, amount: result.business_amount, tax_category: "out" });
    if (priv > 0) lines.push({ side: "debit", account_id: sys.ownerDraw, amount: priv, tax_category: "out", memo: `家事分 ${100 - asset.business_ratio}%` });
    lines.push({ side: "credit", account_id: asset.account_id, amount: result.depreciation, tax_category: "out" });
    const end = asset.disposal_date && asset.disposal_date.startsWith(String(year)) ? asset.disposal_date : `${year}-12-31`;
    await insertJournal(c.env.DB, { date: end, description: `減価償却費 ${asset.name}`, source: "depreciation", source_ref: `${year}:${asset.id}`, lines });
  }
  return c.json({ count: plan.length });
});

closingRoutes.post("/closing/:year/apportion", async (c) => {
  const year = parseYear(c.req.param("year"));
  await removeGenerated(c.env.DB, "apportion", `${year}:%`);
  const { plan, accounts } = await apportionPlan(c.env, year);
  for (const p of plan) {
    const name = accounts.find((a) => a.id === p.account_id)?.name ?? "";
    await insertJournal(c.env.DB, { date: `${year}-12-31`, description: `家事按分 ${name}（事業${p.ratio}%）`, source: "apportion", source_ref: `${year}:${p.account_id}`, lines: p.lines });
  }
  return c.json({ count: plan.length });
});

closingRoutes.post("/closing/:year/inventory", async (c) => {
  const year = parseYear(c.req.param("year"));
  const { amount } = await c.req.json<{ amount: number }>();
  const v = Math.round(Number(amount));
  if (!Number.isInteger(v) || v < 0) throw new HttpError(400, "期末棚卸高は0以上の整数で入力してください");
  const sys = systemAccounts(await getAccounts(c.env.DB));
  await removeGenerated(c.env.DB, "inventory", `${year}:closing`);
  if (v > 0) {
    await insertJournal(c.env.DB, {
      date: `${year}-12-31`,
      description: "期末商品棚卸高",
      source: "inventory",
      source_ref: `${year}:closing`,
      lines: [
        { side: "debit", account_id: sys.inventory, amount: v, tax_category: "out" },
        { side: "credit", account_id: sys.closingInventory, amount: v, tax_category: "out" },
      ],
    });
  }
  return c.json({ ok: true });
});

/** 翌年への繰越（期首残高の作成・元入金の再計算・期首棚卸の振替） */
closingRoutes.post("/closing/:year/carry-forward", async (c) => {
  const year = parseYear(c.req.param("year"));
  const db = c.env.DB;
  const { from, to } = yearRange(year);
  const [accounts, opening, mv, settings] = await Promise.all([getAccounts(db), getOpening(db, year), getMovements(db, from, to), getSettings(db)]);
  const sys = systemAccounts(accounts);
  const balances = buildBalances(accounts, opening, mv);
  const pl = buildProfitAndLoss(balances, Number(settings.blue_deduction) || 0);
  const next = carryForward(balances, sys.ownerDraw, sys.ownerContrib, sys.capital);
  // 「元入金 = 期首元入金 + 所得 + 事業主借 - 事業主貸」と一致することを検算
  const b = (id: number) => balances.find((x) => x.account.id === id)?.closing ?? 0;
  const expected = b(sys.capital) + pl.income_before_deduction + b(sys.ownerContrib) - b(sys.ownerDraw);
  if (expected !== next.get(sys.capital)) {
    throw new HttpError(409, `貸借が一致しません（期首残高が不整合の可能性があります）。計算上の元入金 ${expected.toLocaleString()} / 資産負債差額 ${next.get(sys.capital)?.toLocaleString()}`);
  }
  await db.batch([
    db.prepare("DELETE FROM opening_balances WHERE fiscal_year = ?").bind(year + 1),
    ...[...next].map(([id, amt]) => db.prepare("INSERT INTO opening_balances (fiscal_year, account_id, amount) VALUES (?, ?, ?)").bind(year + 1, id, amt)),
  ]);
  await removeGenerated(db, "inventory", `${year + 1}:opening`);
  const inv = next.get(sys.inventory) ?? 0;
  if (inv > 0) {
    await insertJournal(db, {
      date: `${year + 1}-01-01`,
      description: "期首商品棚卸高（前期繰越）",
      source: "inventory",
      source_ref: `${year + 1}:opening`,
      lines: [
        { side: "debit", account_id: sys.openingInventory, amount: inv, tax_category: "out" },
        { side: "credit", account_id: sys.inventory, amount: inv, tax_category: "out" },
      ],
    });
  }
  await db.prepare("INSERT INTO settings (key, value) VALUES ('fiscal_year', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(year + 1)).run();
  return c.json({ ok: true, capital: next.get(sys.capital) });
});
