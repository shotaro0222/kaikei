import type { Category, TaxCategory } from "./types";

export const yen = (n: number | null | undefined) => (n == null ? "" : Math.round(n).toLocaleString("ja-JP"));
export const yenSign = (n: number | null | undefined) => (n == null ? "" : `¥${Math.round(n).toLocaleString("ja-JP")}`);

export const TAX_LABELS: Record<TaxCategory, string> = {
  taxable10: "課税10%",
  taxable8: "課税8%(軽減)",
  exempt: "非課税",
  out: "対象外",
  export: "輸出免税",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  asset: "資産",
  liability: "負債",
  equity: "資本",
  revenue: "収益",
  expense: "費用",
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: "手入力",
  quick: "かんたん入力",
  bank: "明細取込",
  csv: "CSV",
  depreciation: "減価償却",
  apportion: "家事按分",
  inventory: "棚卸",
};

export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.click();
}
