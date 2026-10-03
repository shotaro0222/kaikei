export type Category = "asset" | "liability" | "equity" | "revenue" | "expense";
export type Side = "debit" | "credit";
export type TaxCategory = "taxable10" | "taxable8" | "exempt" | "out" | "export";
export type Direction = "expense" | "income";

export const TAX_CATEGORIES: TaxCategory[] = ["taxable10", "taxable8", "exempt", "out", "export"];

export interface Account {
  id: number;
  code: string;
  name: string;
  category: Category;
  report_line: string | null;
  tax_default: TaxCategory;
  is_system: number;
  active: number;
  sort_order: number;
}

export interface LineInput {
  side: Side;
  account_id: number;
  amount: number;
  tax_category?: TaxCategory;
  memo?: string | null;
}

export interface JournalInput {
  date: string;
  description: string;
  partner?: string | null;
  memo?: string | null;
  source?: string;
  source_ref?: string | null;
  lines: LineInput[];
}

export interface ApportionRule {
  id: number;
  account_id: number;
  business_ratio: number;
  timing: "entry" | "year_end";
  basis: string | null;
  active: number;
}

export interface ClassificationRule {
  id: number;
  keyword: string;
  match_type: "contains" | "exact" | "prefix" | "regex";
  direction: Direction | "any";
  account_id: number;
  tax_category: TaxCategory | null;
  partner: string | null;
  priority: number;
  kind: "user" | "learned";
  hits: number;
}

/** 資産・費用は借方残高が正、負債・資本・収益は貸方残高が正 */
export function isDebitNormal(category: Category): boolean {
  return category === "asset" || category === "expense";
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
