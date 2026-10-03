import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../db";
import { computeDepreciation, type FixedAsset } from "../lib/depreciation";
import { isValidDate } from "../lib/types";

export const assetRoutes = new Hono<AppEnv>();

function check(b: Partial<FixedAsset>): FixedAsset {
  if (!b.name?.trim()) throw new HttpError(400, "資産名は必須です");
  if (!isValidDate(b.acquisition_date)) throw new HttpError(400, "取得日が不正です");
  if (b.service_date && !isValidDate(b.service_date)) throw new HttpError(400, "事業供用日が不正です");
  if (b.disposal_date && !isValidDate(b.disposal_date)) throw new HttpError(400, "除却日が不正です");
  const cost = Number(b.acquisition_cost);
  if (!Number.isInteger(cost) || cost <= 0) throw new HttpError(400, "取得価額は1円以上の整数で入力してください");
  const method = (["straight_line", "lump_sum", "immediate"] as const).includes(b.method as never) ? b.method! : "straight_line";
  const life = Number(b.useful_life) || 1;
  if (method === "straight_line" && (life < 2 || life > 100)) throw new HttpError(400, "耐用年数は2〜100年で入力してください");
  if (method === "immediate" && cost >= 300_000) throw new HttpError(400, "少額減価償却資産の特例は取得価額30万円未満が対象です");
  if (method === "lump_sum" && cost >= 200_000) throw new HttpError(400, "一括償却資産は取得価額20万円未満が対象です");
  const ratio = Number(b.business_ratio ?? 100);
  if (!(ratio >= 0 && ratio <= 100)) throw new HttpError(400, "事業専用割合は0〜100%で入力してください");
  return {
    id: 0,
    name: b.name.trim(),
    account_id: Number(b.account_id),
    quantity: Number(b.quantity) || 1,
    acquisition_date: b.acquisition_date,
    service_date: b.service_date || null,
    acquisition_cost: cost,
    useful_life: method === "lump_sum" ? 3 : method === "immediate" ? 1 : life,
    method,
    business_ratio: Math.round(ratio),
    disposal_date: b.disposal_date || null,
    memo: b.memo ?? null,
  };
}

assetRoutes.get("/assets", async (c) => {
  const year = Number(c.req.query("year")) || new Date().getFullYear();
  const r = await c.env.DB.prepare("SELECT * FROM fixed_assets ORDER BY acquisition_date, id").all<FixedAsset>();
  return c.json(r.results.map((a) => ({ ...a, schedule: computeDepreciation(a, year) })));
});

assetRoutes.post("/assets", async (c) => {
  const a = check(await c.req.json());
  const r = await c.env.DB.prepare(
    `INSERT INTO fixed_assets (name, account_id, quantity, acquisition_date, service_date, acquisition_cost, useful_life, method, business_ratio, disposal_date, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(a.name, a.account_id, a.quantity, a.acquisition_date, a.service_date, a.acquisition_cost, a.useful_life, a.method, a.business_ratio, a.disposal_date, a.memo)
    .run();
  return c.json({ id: r.meta.last_row_id });
});

assetRoutes.put("/assets/:id", async (c) => {
  const a = check(await c.req.json());
  await c.env.DB.prepare(
    `UPDATE fixed_assets SET name = ?, account_id = ?, quantity = ?, acquisition_date = ?, service_date = ?, acquisition_cost = ?, useful_life = ?,
            method = ?, business_ratio = ?, disposal_date = ?, memo = ? WHERE id = ?`,
  )
    .bind(a.name, a.account_id, a.quantity, a.acquisition_date, a.service_date, a.acquisition_cost, a.useful_life, a.method, a.business_ratio, a.disposal_date, a.memo, Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

assetRoutes.delete("/assets/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM fixed_assets WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
