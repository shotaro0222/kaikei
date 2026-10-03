import { describe, expect, it } from "vitest";
import { basicDeduction, calcIncomeTax, incomeTaxOn } from "../src/worker/lib/incomeTax";
import { calcConsumptionTax, emptyBuckets } from "../src/worker/lib/consumptionTax";

const zero = { social_insurance: 0, small_business_mutual: 0, life_insurance: 0, earthquake_insurance: 0, medical: 0, donation: 0, spouse: 0, dependents: 0, other: 0 };

describe("所得税", () => {
  it("速算表", () => {
    expect(incomeTaxOn(1_000_000)).toBe(50_000);
    expect(incomeTaxOn(3_000_000)).toBe(202_500);
    expect(incomeTaxOn(5_000_000)).toBe(572_500);
    expect(incomeTaxOn(10_000_000)).toBe(1_764_000);
  });

  it("基礎控除（令和7年分以降）", () => {
    expect(basicDeduction(1_000_000, 2025)).toBe(950_000);
    expect(basicDeduction(3_000_000, 2025)).toBe(880_000);
    expect(basicDeduction(5_000_000, 2025)).toBe(630_000);
    expect(basicDeduction(10_000_000, 2025)).toBe(580_000);
    expect(basicDeduction(10_000_000, 2024)).toBe(480_000);
  });

  it("事業所得500万円・社会保険料80万円", () => {
    const r = calcIncomeTax({
      year: 2025,
      business_income: 5_000_000,
      other: { salary_income: 0, misc_income: 0, other_income: 0 },
      deductions: { ...zero, social_insurance: 800_000 },
      withholding: 100_000,
      prepaid: 0,
    });
    // 課税所得 = 5,000,000 - 800,000 - 630,000 = 3,570,000
    expect(r.taxable_income).toBe(3_570_000);
    expect(r.income_tax).toBe(286_500);
    expect(r.reconstruction_tax).toBe(6_016);
    expect(r.total_tax).toBe(292_516);
    expect(r.payable).toBe(192_500);
  });

  it("基礎控除の手入力・還付", () => {
    const r = calcIncomeTax({
      year: 2026,
      business_income: 1_000_000,
      other: { salary_income: 0, misc_income: 0, other_income: 0 },
      deductions: { ...zero, basic_override: 1_040_000 },
      withholding: 30_000,
      prepaid: 0,
    });
    expect(r.taxable_income).toBe(0);
    expect(r.payable).toBe(-30_000);
  });
});

describe("消費税", () => {
  const b = emptyBuckets();
  b.sales.taxable10 = 11_000_000;
  b.purchases.taxable10 = 3_300_000;

  it("2割特例", () => {
    const r = calcConsumptionTax(b, "twenty_percent");
    expect(r.tax_base_10).toBe(10_000_000);
    expect(r.output_tax).toBe(780_000);
    expect(r.national_tax).toBe(156_000);
    expect(r.local_tax).toBe(44_000);
    expect(r.total).toBe(200_000);
  });

  it("簡易課税（第5種 50%）", () => {
    const r = calcConsumptionTax(b, "simplified", 5);
    expect(r.national_tax).toBe(390_000);
  });

  it("本則課税", () => {
    const r = calcConsumptionTax(b, "general");
    expect(r.input_tax).toBe(234_000);
    expect(r.national_tax).toBe(546_000);
  });

  it("免税事業者は0", () => {
    expect(calcConsumptionTax(b, "exempt").total).toBe(0);
  });
});
