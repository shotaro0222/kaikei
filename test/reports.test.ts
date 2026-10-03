import { describe, expect, it } from "vitest";
import { buildBalanceSheet, buildBalances, buildProfitAndLoss, carryForward } from "../src/worker/lib/reports";
import { A, ACCOUNTS } from "./fixtures";

function mv(entries: Array<[string, number, number]>) {
  return new Map(entries.map(([n, d, c]) => [A[n], { debit: d, credit: c }]));
}

describe("決算書", () => {
  // 期首: 普通預金 1,000,000 / 元入金 1,000,000
  const opening = new Map([[A["普通預金"], 1_000_000], [A["元入金"], 1_000_000]]);
  // 期中: 売上 5,000,000（預金入金）、通信費 120,000、地代家賃 600,000、会議費 50,000、事業主貸 1,200,000
  const movements = mv([
    ["普通預金", 5_000_000, 120_000 + 600_000 + 50_000 + 1_200_000 + 200_000],
    ["売上高", 0, 5_000_000],
    ["通信費", 120_000, 0],
    ["地代家賃", 600_000, 0],
    ["会議費", 50_000, 0],
    ["事業主貸", 1_200_000, 0],
    ["仕入高", 200_000, 0],
    ["商品", 80_000, 0],
    ["期末商品棚卸高", 0, 80_000],
  ]);
  const balances = buildBalances(ACCOUNTS, opening, movements);
  const pl = buildProfitAndLoss(balances, 650_000);

  it("損益計算書", () => {
    expect(pl.sales).toBe(5_000_000);
    expect(pl.purchases).toBe(200_000);
    expect(pl.closing_inventory).toBe(80_000);
    expect(pl.cost_of_sales).toBe(120_000);
    expect(pl.total_expenses).toBe(770_000);
    expect(pl.income_before_deduction).toBe(4_110_000);
    expect(pl.blue_deduction).toBe(650_000);
    expect(pl.income).toBe(3_460_000);
    expect(pl.expenses.find((e) => e.no === "㉕")).toEqual({ no: "㉕", label: "会議費", amount: 50_000 });
  });

  it("貸借対照表の貸借一致", () => {
    const bs = buildBalanceSheet(balances, pl.income_before_deduction);
    expect(bs.total_assets.closing).toBe(bs.total_liabilities.closing);
    expect(bs.total_assets.opening).toBe(bs.total_liabilities.opening);
  });

  it("青色申告特別控除は所得を上限とする", () => {
    const small = buildProfitAndLoss(buildBalances(ACCOUNTS, new Map(), mv([["売上高", 0, 300_000], ["普通預金", 300_000, 0]])), 650_000);
    expect(small.blue_deduction).toBe(300_000);
    expect(small.income).toBe(0);
  });

  it("翌年繰越: 元入金 = 元入金 + 所得 + 事業主借 - 事業主貸", () => {
    const next = carryForward(balances, A["事業主貸"], A["事業主借"], A["元入金"]);
    expect(next.get(A["元入金"])).toBe(1_000_000 + 4_110_000 - 1_200_000);
    expect(next.get(A["事業主貸"])).toBeUndefined();
    expect(next.get(A["商品"])).toBe(80_000);
  });
});
