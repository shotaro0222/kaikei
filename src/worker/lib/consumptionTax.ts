import type { TaxCategory } from "./types";

/**
 * 消費税の概算（税込経理前提）。
 * method: exempt（免税事業者） / general（本則課税） / simplified（簡易課税） / twenty_percent（2割特例）
 */
export type ConsumptionMethod = "exempt" | "general" | "simplified" | "twenty_percent";

export interface TaxBuckets {
  sales: Record<TaxCategory, number>; // 収益側（税込）
  purchases: Record<TaxCategory, number>; // 費用・資産取得側（税込）
}

export interface ConsumptionTaxResult {
  method: ConsumptionMethod;
  taxable_sales_10: number;
  taxable_sales_8: number;
  tax_base_10: number; // 課税標準額（千円未満切捨て）
  tax_base_8: number;
  output_tax: number; // 売上に係る消費税額（国税）
  input_tax: number; // 控除対象仕入税額（国税）
  national_tax: number; // 差引税額（国税・百円未満切捨て）
  local_tax: number; // 地方消費税（百円未満切捨て）
  total: number;
  deemed_rate?: number; // 簡易課税のみなし仕入率
}

export const DEEMED_PURCHASE_RATES: Record<number, number> = { 1: 0.9, 2: 0.8, 3: 0.7, 4: 0.6, 5: 0.5, 6: 0.4 };

export function emptyBuckets(): TaxBuckets {
  const z = (): Record<TaxCategory, number> => ({ taxable10: 0, taxable8: 0, exempt: 0, out: 0, export: 0 });
  return { sales: z(), purchases: z() };
}

export function calcConsumptionTax(b: TaxBuckets, method: ConsumptionMethod, simplifiedCategory = 5): ConsumptionTaxResult {
  const s10 = b.sales.taxable10;
  const s8 = b.sales.taxable8;
  const base10 = Math.floor((s10 * 100) / 110 / 1000) * 1000;
  const base8 = Math.floor((s8 * 100) / 108 / 1000) * 1000;
  const output = Math.floor(base10 * 0.078) + Math.floor(base8 * 0.0624);

  let input = 0;
  let deemed: number | undefined;
  if (method === "general") {
    input = Math.floor((b.purchases.taxable10 * 7.8) / 110) + Math.floor((b.purchases.taxable8 * 6.24) / 108);
  } else if (method === "simplified") {
    deemed = DEEMED_PURCHASE_RATES[simplifiedCategory] ?? 0.5;
    input = Math.floor(output * deemed);
  } else if (method === "twenty_percent") {
    input = Math.floor(output * 0.8);
  }

  if (method === "exempt") {
    return { method, taxable_sales_10: s10, taxable_sales_8: s8, tax_base_10: base10, tax_base_8: base8, output_tax: output, input_tax: 0, national_tax: 0, local_tax: 0, total: 0 };
  }
  const national = Math.max(0, Math.floor((output - input) / 100) * 100);
  const local = Math.floor((national * 22) / 78 / 100) * 100;
  return {
    method,
    taxable_sales_10: s10,
    taxable_sales_8: s8,
    tax_base_10: base10,
    tax_base_8: base8,
    output_tax: output,
    input_tax: input,
    national_tax: national,
    local_tax: local,
    total: national + local,
    deemed_rate: deemed,
  };
}
