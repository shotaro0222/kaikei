import { describe, expect, it } from "vitest";
import { buildQuickLines, includedTax, monthlyDates, validateLines } from "../src/worker/lib/journal";
import { yearEndApportion } from "../src/worker/lib/apportion";
import { A } from "./fixtures";

const base = { owner_draw_id: A["事業主貸"], owner_contrib_id: A["事業主借"], tax_category: "taxable10" as const };

describe("buildQuickLines", () => {
  it("支出: 経費 / 支払元", () => {
    const l = buildQuickLines({ ...base, direction: "expense", amount: 1100, account_id: A["消耗品費"], counter_account_id: A["現金"] });
    expect(l).toEqual([
      { side: "debit", account_id: A["消耗品費"], amount: 1100, tax_category: "taxable10" },
      { side: "credit", account_id: A["現金"], amount: 1100, tax_category: "out" },
    ]);
    expect(validateLines(l)).toBeNull();
  });

  it("収入: 入金先 / 売上", () => {
    const l = buildQuickLines({ ...base, direction: "income", amount: 50000, account_id: A["売上高"], counter_account_id: A["普通預金"] });
    expect(l[0]).toMatchObject({ side: "debit", account_id: A["普通預金"] });
    expect(l[1]).toMatchObject({ side: "credit", account_id: A["売上高"], tax_category: "taxable10" });
  });

  it("入力時の家事按分（事業用口座から支払）", () => {
    const l = buildQuickLines({ ...base, direction: "expense", amount: 10000, account_id: A["通信費"], counter_account_id: A["普通預金"], business_ratio: 60 });
    expect(l).toHaveLength(3);
    expect(l[0]).toMatchObject({ account_id: A["通信費"], amount: 6000 });
    expect(l[1]).toMatchObject({ account_id: A["事業主貸"], amount: 4000 });
    expect(l[2]).toMatchObject({ side: "credit", account_id: A["普通預金"], amount: 10000 });
    expect(validateLines(l)).toBeNull();
  });

  it("入力時の家事按分（私費で支払）は事業分のみ記帳", () => {
    const l = buildQuickLines({ ...base, direction: "expense", amount: 12345, account_id: A["水道光熱費"], counter_account_id: A["事業主借"], business_ratio: 30 });
    expect(l).toEqual([
      expect.objectContaining({ side: "debit", account_id: A["水道光熱費"], amount: 3704 }),
      expect.objectContaining({ side: "credit", account_id: A["事業主借"], amount: 3704 }),
    ]);
  });

  it("不正な金額はエラー", () => {
    expect(() => buildQuickLines({ ...base, direction: "expense", amount: 0, account_id: 1, counter_account_id: 2 })).toThrow();
    expect(() => buildQuickLines({ ...base, direction: "expense", amount: 1.5, account_id: 1, counter_account_id: 2 })).toThrow();
  });
});

describe("validateLines", () => {
  it("貸借不一致を検出", () => {
    expect(validateLines([
      { side: "debit", account_id: 1, amount: 100 },
      { side: "credit", account_id: 2, amount: 90 },
    ])).toMatch(/貸借/);
  });
  it("1行のみはエラー", () => {
    expect(validateLines([{ side: "debit", account_id: 1, amount: 100 }])).not.toBeNull();
  });
});

describe("includedTax", () => {
  it("税込金額から割り戻す", () => {
    expect(includedTax(1100, "taxable10")).toBe(100);
    expect(includedTax(1080, "taxable8")).toBe(80);
    expect(includedTax(1000, "exempt")).toBe(0);
  });
});

describe("yearEndApportion", () => {
  it("私用分を事業主貸へ振り替える", () => {
    const totals = new Map([[A["地代家賃"], 1_200_000], [A["通信費"], 0]]);
    const rules = [
      { id: 1, account_id: A["地代家賃"], business_ratio: 30, timing: "year_end" as const, basis: null, active: 1 },
      { id: 2, account_id: A["通信費"], business_ratio: 50, timing: "year_end" as const, basis: null, active: 1 },
      { id: 3, account_id: A["水道光熱費"], business_ratio: 50, timing: "entry" as const, basis: null, active: 1 },
    ];
    const r = yearEndApportion(totals, rules, A["事業主貸"], () => "taxable10");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ business: 360_000, private: 840_000 });
    expect(r[0].lines[0]).toMatchObject({ side: "debit", account_id: A["事業主貸"], amount: 840_000 });
    expect(r[0].lines[1]).toMatchObject({ side: "credit", account_id: A["地代家賃"], amount: 840_000, tax_category: "taxable10" });
  });
});

describe("monthlyDates", () => {
  it("同じ日付で12か月分", () => {
    const d = monthlyDates("2026-01-25", 12);
    expect(d).toHaveLength(12);
    expect(d[0]).toBe("2026-01-25");
    expect(d[11]).toBe("2026-12-25");
  });
  it("年をまたぐ", () => {
    expect(monthlyDates("2026-11-10", 3)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
  });
  it("月末日から始めると毎月末日", () => {
    expect(monthlyDates("2026-01-31", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(monthlyDates("2026-04-30", 2)).toEqual(["2026-04-30", "2026-05-31"]);
  });
  it("その月に無い日は月末日に丸める", () => {
    expect(monthlyDates("2026-01-30", 3)).toEqual(["2026-01-30", "2026-02-28", "2026-03-30"]);
    expect(monthlyDates("2028-01-29", 2)).toEqual(["2028-01-29", "2028-02-29"]);
  });
});
