export type Category = "asset" | "liability" | "equity" | "revenue" | "expense";
export type TaxCategory = "taxable10" | "taxable8" | "exempt" | "out" | "export";
export type Direction = "expense" | "income";

export interface Account {
  id: number;
  code: string;
  name: string;
  category: Category;
  report_line: string | null;
  tax_default: TaxCategory;
  is_system: number;
  active: number;
}

export interface Line {
  id?: number;
  side: "debit" | "credit";
  account_id: number;
  amount: number;
  tax_category?: TaxCategory;
  memo?: string | null;
}

export interface Journal {
  id: number;
  date: string;
  description: string;
  partner: string | null;
  memo: string | null;
  source: string;
  source_ref: string | null;
  lines: Line[];
  receipts?: Array<{ id: number; file_name: string }>;
}

export interface Suggestion {
  account_id: number;
  tax_category: TaxCategory;
  partner: string | null;
  confidence: number;
  source: string;
  reason: string;
}

export type Settings = Record<string, string>;
