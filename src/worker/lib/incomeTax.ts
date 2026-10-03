/**
 * 所得税（確定申告書 第一表）の計算。
 * 税制は年分ごとに改正されるため、基礎控除は年分別テーブルで管理し、
 * 申告画面から上書きもできるようにしている。
 */

export interface Deductions {
  social_insurance: number; // 社会保険料控除（国民健康保険・国民年金 等）
  small_business_mutual: number; // 小規模企業共済等掛金控除（iDeCo 含む）
  life_insurance: number; // 生命保険料控除
  earthquake_insurance: number; // 地震保険料控除
  medical: number; // 医療費控除
  donation: number; // 寄附金控除（ふるさと納税 等）
  spouse: number; // 配偶者（特別）控除
  dependents: number; // 扶養控除
  other: number; // 寡婦・ひとり親・勤労学生・障害者控除 等
  basic_override?: number | null; // 基礎控除を手入力する場合
}

export interface OtherIncome {
  salary_income: number; // 給与所得（給与所得控除後）
  misc_income: number; // 雑所得
  other_income: number; // その他の総合課税所得
}

export interface IncomeTaxInput {
  year: number;
  business_income: number; // 事業所得（青色申告特別控除後）
  other: OtherIncome;
  deductions: Deductions;
  withholding: number; // 源泉徴収税額
  prepaid: number; // 予定納税額
}

export interface IncomeTaxResult {
  total_income: number; // 合計所得金額
  basic_deduction: number;
  total_deductions: number;
  taxable_income: number; // 課税される所得金額（千円未満切捨て）
  income_tax: number; // 算出税額
  reconstruction_tax: number; // 復興特別所得税
  total_tax: number; // 所得税及び復興特別所得税の額
  withholding: number;
  prepaid: number;
  payable: number; // 納める税金（マイナスは還付）
}

/** 基礎控除額（令和7年分以降の改正後。令和8年度改正等で変わる場合は basic_override で調整） */
export function basicDeduction(totalIncome: number, year: number): number {
  if (year <= 2019) return totalIncome <= 24_000_000 ? 380_000 : 0;
  if (year <= 2024) {
    if (totalIncome <= 24_000_000) return 480_000;
    if (totalIncome <= 24_500_000) return 320_000;
    if (totalIncome <= 25_000_000) return 160_000;
    return 0;
  }
  // 令和7年分・令和8年分（特例加算あり）
  if (totalIncome <= 1_320_000) return 950_000;
  if (totalIncome <= 3_360_000) return 880_000;
  if (totalIncome <= 4_890_000) return 680_000;
  if (totalIncome <= 6_550_000) return 630_000;
  if (totalIncome <= 23_500_000) return 580_000;
  if (totalIncome <= 24_000_000) return 480_000;
  if (totalIncome <= 24_500_000) return 320_000;
  if (totalIncome <= 25_000_000) return 160_000;
  return 0;
}

/** 所得税の速算表 */
const BRACKETS: Array<[limit: number, rate: number, deduct: number]> = [
  [1_949_000, 0.05, 0],
  [3_299_000, 0.1, 97_500],
  [6_949_000, 0.2, 427_500],
  [8_999_000, 0.23, 636_000],
  [17_999_000, 0.33, 1_536_000],
  [39_999_000, 0.4, 2_796_000],
  [Infinity, 0.45, 4_796_000],
];

export function incomeTaxOn(taxable: number): number {
  if (taxable <= 0) return 0;
  for (const [limit, rate, deduct] of BRACKETS) {
    if (taxable <= limit) return Math.floor(taxable * rate - deduct);
  }
  return 0;
}

export function calcIncomeTax(input: IncomeTaxInput): IncomeTaxResult {
  const totalIncome =
    Math.max(0, input.business_income) +
    Math.max(0, input.other.salary_income) +
    Math.max(0, input.other.misc_income) +
    Math.max(0, input.other.other_income) +
    Math.min(0, input.business_income); // 事業所得の赤字は損益通算
  const d = input.deductions;
  const basic = d.basic_override != null && d.basic_override >= 0 ? d.basic_override : basicDeduction(totalIncome, input.year);
  const totalDeductions =
    d.social_insurance + d.small_business_mutual + d.life_insurance + d.earthquake_insurance + d.medical + d.donation + d.spouse + d.dependents + d.other + basic;
  const taxable = Math.max(0, Math.floor((Math.max(0, totalIncome) - totalDeductions) / 1000) * 1000);
  const incomeTax = incomeTaxOn(taxable);
  const reconstruction = Math.floor(incomeTax * 0.021);
  const totalTax = incomeTax + reconstruction;
  const payableRaw = totalTax - input.withholding - input.prepaid;
  // 納付は百円未満切捨て、還付はそのまま
  const payable = payableRaw >= 0 ? Math.floor(payableRaw / 100) * 100 : payableRaw;
  return {
    total_income: totalIncome,
    basic_deduction: basic,
    total_deductions: totalDeductions,
    taxable_income: taxable,
    income_tax: incomeTax,
    reconstruction_tax: reconstruction,
    total_tax: totalTax,
    withholding: input.withholding,
    prepaid: input.prepaid,
    payable,
  };
}
