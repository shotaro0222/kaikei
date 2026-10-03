import type { Account, Category, TaxCategory } from "../src/worker/lib/types";

let nextId = 1;
function acc(name: string, category: Category, report_line: string | null = null, tax: TaxCategory = "out"): Account {
  const id = nextId++;
  return { id, code: String(100 + id), name, category, report_line, tax_default: tax, is_system: 1, active: 1, sort_order: id };
}

export const ACCOUNTS: Account[] = [
  acc("現金", "asset"),
  acc("普通預金", "asset"),
  acc("売掛金", "asset"),
  acc("商品", "asset"),
  acc("工具器具備品", "asset", null, "taxable10"),
  acc("事業主貸", "asset"),
  acc("未払金", "liability"),
  acc("事業主借", "equity"),
  acc("元入金", "equity"),
  acc("売上高", "revenue", "sales", "taxable10"),
  acc("雑収入", "revenue", "misc_income", "taxable10"),
  acc("期首商品棚卸高", "expense", "opening_inventory"),
  acc("仕入高", "expense", "purchases", "taxable10"),
  acc("期末商品棚卸高", "expense", "closing_inventory"),
  acc("水道光熱費", "expense", "utilities", "taxable10"),
  acc("旅費交通費", "expense", "travel", "taxable10"),
  acc("通信費", "expense", "communication", "taxable10"),
  acc("消耗品費", "expense", "supplies", "taxable10"),
  acc("減価償却費", "expense", "depreciation"),
  acc("地代家賃", "expense", "rent", "taxable10"),
  acc("会議費", "expense", null, "taxable10"),
  acc("新聞図書費", "expense", null, "taxable10"),
  acc("雑費", "expense", "misc", "taxable10"),
];

export const A = Object.fromEntries(ACCOUNTS.map((a) => [a.name, a.id])) as Record<string, number>;
