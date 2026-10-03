import { describe, expect, it } from "vitest";
import { computeDepreciation, straightLineRate, type FixedAsset } from "../src/worker/lib/depreciation";

const pc: FixedAsset = {
  id: 1, name: "ノートPC", account_id: 1, quantity: 1, acquisition_date: "2025-04-10", service_date: null,
  acquisition_cost: 300_000, useful_life: 4, method: "straight_line", business_ratio: 80, disposal_date: null, memo: null,
};

describe("straightLineRate", () => {
  it("耐用年数省令の償却率と一致", () => {
    expect(straightLineRate(2)).toBe(0.5);
    expect(straightLineRate(3)).toBe(0.334);
    expect(straightLineRate(4)).toBe(0.25);
    expect(straightLineRate(6)).toBe(0.167);
    expect(straightLineRate(15)).toBe(0.067);
    expect(straightLineRate(22)).toBe(0.046);
    expect(straightLineRate(47)).toBe(0.022);
  });
});

describe("computeDepreciation", () => {
  it("初年度は月割（4月取得→9か月）", () => {
    const r = computeDepreciation(pc, 2025);
    expect(r.months).toBe(9);
    expect(r.depreciation).toBe(56_250);
    expect(r.business_amount).toBe(45_000);
    expect(r.closing_book).toBe(243_750);
  });
  it("2年目以降は12か月、最終年は備忘価額1円を残す", () => {
    expect(computeDepreciation(pc, 2026).depreciation).toBe(75_000);
    expect(computeDepreciation(pc, 2028).depreciation).toBe(75_000);
    const last = computeDepreciation(pc, 2029);
    expect(last.depreciation).toBe(18_749);
    expect(last.closing_book).toBe(1);
    expect(computeDepreciation(pc, 2030).depreciation).toBe(0);
  });
  it("取得前の年は0", () => {
    expect(computeDepreciation(pc, 2024).depreciation).toBe(0);
  });
  it("一括償却資産は3年均等", () => {
    const a = { ...pc, acquisition_cost: 150_000, method: "lump_sum" as const, acquisition_date: "2025-12-01" };
    expect(computeDepreciation(a, 2025).depreciation).toBe(50_000);
    expect(computeDepreciation(a, 2026).depreciation).toBe(50_000);
    expect(computeDepreciation(a, 2027).depreciation).toBe(50_000);
    expect(computeDepreciation(a, 2027).closing_book).toBe(0);
    expect(computeDepreciation(a, 2028).depreciation).toBe(0);
  });
  it("少額減価償却資産の特例は取得年に全額", () => {
    const a = { ...pc, acquisition_cost: 250_000, method: "immediate" as const };
    expect(computeDepreciation(a, 2025).depreciation).toBe(250_000);
    expect(computeDepreciation(a, 2026).depreciation).toBe(0);
  });
  it("除却年は除却月までの月割", () => {
    const a = { ...pc, disposal_date: "2026-06-30" };
    const r = computeDepreciation(a, 2026);
    expect(r.months).toBe(6);
    expect(r.depreciation).toBe(37_500);
    expect(computeDepreciation(a, 2027).depreciation).toBe(0);
  });
});
