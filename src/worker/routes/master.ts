import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError, getAccounts, getApportionRules } from "../db";
import type { Category, TaxCategory } from "../lib/types";
import { TAX_CATEGORIES } from "../lib/types";
import { classify } from "../lib/classifier";
import { getRules } from "../db";

export const masterRoutes = new Hono<AppEnv>();

// ---------- 設定 ----------
const SETTING_KEYS = [
  "business_name", "owner_name", "owner_kana", "address", "business_address", "phone", "business_type",
  "filing_type", "blue_deduction", "consumption_tax", "simplified_category", "invoice_no", "ai_enabled", "fiscal_year",
];

masterRoutes.get("/settings", async (c) => {
  const r = await c.env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return c.json(Object.fromEntries(r.results.map((x) => [x.key, x.value])));
});

masterRoutes.put("/settings", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const stmts = Object.entries(body)
    .filter(([k]) => SETTING_KEYS.includes(k))
    .map(([k, v]) =>
      c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v ?? "")),
    );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---------- 勘定科目 ----------
masterRoutes.get("/accounts", async (c) => c.json(await getAccounts(c.env.DB)));

const CATEGORIES: Category[] = ["asset", "liability", "equity", "revenue", "expense"];

masterRoutes.post("/accounts", async (c) => {
  const b = await c.req.json<{ code: string; name: string; category: Category; tax_default?: TaxCategory; report_line?: string | null }>();
  if (!b.code?.trim() || !b.name?.trim()) throw new HttpError(400, "コードと科目名は必須です");
  if (!CATEGORIES.includes(b.category)) throw new HttpError(400, "区分が不正です");
  const tax = TAX_CATEGORIES.includes(b.tax_default as TaxCategory) ? b.tax_default : "out";
  const r = await c.env.DB.prepare(
    "INSERT INTO accounts (code, name, category, report_line, tax_default, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(b.code.trim(), b.name.trim(), b.category, b.report_line || null, tax, Number(b.code) || 900)
    .run()
    .catch(() => {
      throw new HttpError(409, "同じコードまたは科目名が既に存在します");
    });
  return c.json({ id: r.meta.last_row_id });
});

masterRoutes.put("/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<{ name?: string; tax_default?: TaxCategory; active?: boolean; report_line?: string | null }>();
  const acc = await c.env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<{ is_system: number; name: string }>();
  if (!acc) throw new HttpError(404, "勘定科目が見つかりません");
  if (acc.is_system && b.name && b.name !== acc.name) throw new HttpError(400, "システム科目の名称は変更できません");
  if (acc.is_system && b.active === false) throw new HttpError(400, "システム科目は無効化できません");
  await c.env.DB.prepare(
    "UPDATE accounts SET name = COALESCE(?, name), tax_default = COALESCE(?, tax_default), active = COALESCE(?, active), report_line = CASE WHEN ? THEN ? ELSE report_line END WHERE id = ?",
  )
    .bind(
      b.name?.trim() || null,
      TAX_CATEGORIES.includes(b.tax_default as TaxCategory) ? b.tax_default : null,
      b.active === undefined ? null : b.active ? 1 : 0,
      b.report_line !== undefined && !acc.is_system ? 1 : 0,
      b.report_line || null,
      id,
    )
    .run();
  return c.json({ ok: true });
});

masterRoutes.delete("/accounts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const acc = await c.env.DB.prepare("SELECT is_system FROM accounts WHERE id = ?").bind(id).first<{ is_system: number }>();
  if (!acc) throw new HttpError(404, "勘定科目が見つかりません");
  if (acc.is_system) throw new HttpError(400, "システム科目は削除できません");
  const used = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM journal_lines WHERE account_id = ?1) + (SELECT COUNT(*) FROM opening_balances WHERE account_id = ?1)
          + (SELECT COUNT(*) FROM bank_accounts WHERE account_id = ?1) + (SELECT COUNT(*) FROM fixed_assets WHERE account_id = ?1) AS n`,
  )
    .bind(id)
    .first<{ n: number }>();
  if (used && used.n > 0) {
    await c.env.DB.prepare("UPDATE accounts SET active = 0 WHERE id = ?").bind(id).run();
    return c.json({ ok: true, deactivated: true });
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM classification_rules WHERE account_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM apportion_rules WHERE account_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- 自動仕訳ルール ----------
masterRoutes.get("/rules", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM classification_rules ORDER BY kind, priority DESC, hits DESC, id DESC").all();
  return c.json(r.results);
});

interface RuleBody {
  keyword: string;
  match_type?: string;
  direction?: string;
  account_id: number;
  tax_category?: string | null;
  partner?: string | null;
  priority?: number;
}

function checkRule(b: RuleBody) {
  if (!b.keyword?.trim()) throw new HttpError(400, "キーワードは必須です");
  if (b.match_type === "regex") {
    try {
      new RegExp(b.keyword);
    } catch {
      throw new HttpError(400, "正規表現が不正です");
    }
  }
  if (b.match_type && !["contains", "exact", "prefix", "regex"].includes(b.match_type)) throw new HttpError(400, "一致条件が不正です");
  if (b.direction && !["expense", "income", "any"].includes(b.direction)) throw new HttpError(400, "収支区分が不正です");
}

masterRoutes.post("/rules", async (c) => {
  const b = await c.req.json<RuleBody>();
  checkRule(b);
  await c.env.DB.prepare(
    `INSERT INTO classification_rules (keyword, match_type, direction, account_id, tax_category, partner, priority, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user')
     ON CONFLICT(keyword, match_type, direction) DO UPDATE SET account_id = excluded.account_id, tax_category = excluded.tax_category,
       partner = excluded.partner, priority = excluded.priority, kind = 'user'`,
  )
    .bind(b.keyword.trim(), b.match_type ?? "contains", b.direction ?? "any", b.account_id, b.tax_category || null, b.partner || null, b.priority ?? 0)
    .run();
  return c.json({ ok: true });
});

masterRoutes.put("/rules/:id", async (c) => {
  const b = await c.req.json<RuleBody>();
  checkRule(b);
  await c.env.DB.prepare(
    "UPDATE classification_rules SET keyword = ?, match_type = ?, direction = ?, account_id = ?, tax_category = ?, partner = ?, priority = ?, kind = 'user' WHERE id = ?",
  )
    .bind(b.keyword.trim(), b.match_type ?? "contains", b.direction ?? "any", b.account_id, b.tax_category || null, b.partner || null, b.priority ?? 0, Number(c.req.param("id")))
    .run()
    .catch(() => {
      throw new HttpError(409, "同じ条件のルールが既にあります");
    });
  return c.json({ ok: true });
});

masterRoutes.delete("/rules/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM classification_rules WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

masterRoutes.post("/rules/test", async (c) => {
  const b = await c.req.json<{ text: string; direction: "expense" | "income" }>();
  const [accounts, rules] = await Promise.all([getAccounts(c.env.DB), getRules(c.env.DB)]);
  return c.json(classify(b.text ?? "", b.direction === "income" ? "income" : "expense", rules, accounts));
});

// ---------- 家事按分 ----------
masterRoutes.get("/apportion", async (c) => c.json(await getApportionRules(c.env.DB)));

masterRoutes.put("/apportion", async (c) => {
  const b = await c.req.json<{ account_id: number; business_ratio: number; timing: "entry" | "year_end"; basis?: string; active?: boolean }>();
  const ratio = Math.round(Number(b.business_ratio));
  if (!(ratio >= 0 && ratio <= 100)) throw new HttpError(400, "事業割合は0〜100%で指定してください");
  if (!["entry", "year_end"].includes(b.timing)) throw new HttpError(400, "按分タイミングが不正です");
  const acc = await c.env.DB.prepare("SELECT category FROM accounts WHERE id = ?").bind(b.account_id).first<{ category: string }>();
  if (!acc || acc.category !== "expense") throw new HttpError(400, "家事按分は費用科目にのみ設定できます");
  await c.env.DB.prepare(
    `INSERT INTO apportion_rules (account_id, business_ratio, timing, basis, active) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET business_ratio = excluded.business_ratio, timing = excluded.timing, basis = excluded.basis, active = excluded.active`,
  )
    .bind(b.account_id, ratio, b.timing, b.basis ?? null, b.active === false ? 0 : 1)
    .run();
  return c.json({ ok: true });
});

masterRoutes.delete("/apportion/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM apportion_rules WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// ---------- 期首残高 ----------
masterRoutes.get("/opening/:year", async (c) => {
  const r = await c.env.DB.prepare("SELECT account_id, amount FROM opening_balances WHERE fiscal_year = ?").bind(Number(c.req.param("year"))).all();
  return c.json(r.results);
});

masterRoutes.put("/opening/:year", async (c) => {
  const year = Number(c.req.param("year"));
  const b = await c.req.json<Array<{ account_id: number; amount: number }>>();
  if (!Array.isArray(b)) throw new HttpError(400, "形式が不正です");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM opening_balances WHERE fiscal_year = ?").bind(year),
    ...b
      .filter((x) => Number.isInteger(Number(x.amount)) && Number(x.amount) !== 0)
      .map((x) => c.env.DB.prepare("INSERT INTO opening_balances (fiscal_year, account_id, amount) VALUES (?, ?, ?)").bind(year, x.account_id, Number(x.amount))),
  ]);
  return c.json({ ok: true });
});
