import type { Account } from "./types";
import { isDebitNormal } from "./types";

export interface AccountBalance {
  account: Account;
  opening: number; // 期首残高（通常残高側をプラス）
  debit: number; // 期中借方合計
  credit: number; // 期中貸方合計
  closing: number; // 期末残高（通常残高側をプラス）
}

export function buildBalances(
  accounts: Account[],
  opening: Map<number, number>,
  movements: Map<number, { debit: number; credit: number }>,
): AccountBalance[] {
  return accounts.map((account) => {
    const isPL = account.category === "revenue" || account.category === "expense";
    const op = isPL ? 0 : opening.get(account.id) ?? 0;
    const mv = movements.get(account.id) ?? { debit: 0, credit: 0 };
    const closing = isDebitNormal(account.category) ? op + mv.debit - mv.credit : op + mv.credit - mv.debit;
    return { account, opening: op, debit: mv.debit, credit: mv.credit, closing };
  });
}

/** 損益計算書・決算書の行定義 */
export const EXPENSE_LINES: Array<{ key: string; no: string; label: string }> = [
  { key: "taxes", no: "⑧", label: "租税公課" },
  { key: "packing", no: "⑨", label: "荷造運賃" },
  { key: "utilities", no: "⑩", label: "水道光熱費" },
  { key: "travel", no: "⑪", label: "旅費交通費" },
  { key: "communication", no: "⑫", label: "通信費" },
  { key: "advertising", no: "⑬", label: "広告宣伝費" },
  { key: "entertainment", no: "⑭", label: "接待交際費" },
  { key: "insurance", no: "⑮", label: "損害保険料" },
  { key: "repairs", no: "⑯", label: "修繕費" },
  { key: "supplies", no: "⑰", label: "消耗品費" },
  { key: "depreciation", no: "⑱", label: "減価償却費" },
  { key: "welfare", no: "⑲", label: "福利厚生費" },
  { key: "wages", no: "⑳", label: "給料賃金" },
  { key: "outsourcing", no: "㉑", label: "外注工賃" },
  { key: "interest", no: "㉒", label: "利子割引料" },
  { key: "rent", no: "㉓", label: "地代家賃" },
  { key: "bad_debt", no: "㉔", label: "貸倒金" },
];
const CUSTOM_SLOTS = ["㉕", "㉖", "㉗", "㉘", "㉙", "㉚"];

export interface PLLine {
  no: string;
  label: string;
  amount: number;
}

export interface ProfitAndLoss {
  sales: number; // ① 売上（収入）金額（雑収入を含む）
  sales_only: number;
  misc_income: number;
  opening_inventory: number; // ②
  purchases: number; // ③
  subtotal: number; // ④
  closing_inventory: number; // ⑤
  cost_of_sales: number; // ⑥
  gross_profit: number; // ⑦
  expenses: PLLine[]; // ⑧〜㉛
  total_expenses: number; // ㉜
  operating_income: number; // ㉝
  income_before_deduction: number; // ㊸ 青色申告特別控除前の所得金額
  blue_deduction: number; // ㊹
  income: number; // ㊺ 所得金額
}

export function buildProfitAndLoss(balances: AccountBalance[], blueDeductionLimit: number): ProfitAndLoss {
  const byLine = new Map<string, number>();
  const custom: Array<{ label: string; amount: number }> = [];
  for (const b of balances) {
    const a = b.account;
    if (a.category !== "revenue" && a.category !== "expense") continue;
    if (a.report_line) byLine.set(a.report_line, (byLine.get(a.report_line) ?? 0) + b.closing);
    else if (a.category === "expense" && b.closing !== 0) custom.push({ label: a.name, amount: b.closing });
    else if (a.category === "revenue") byLine.set("misc_income", (byLine.get("misc_income") ?? 0) + b.closing);
  }
  const g = (k: string) => byLine.get(k) ?? 0;

  const salesOnly = g("sales");
  const misc = g("misc_income");
  const sales = salesOnly + misc;
  const openingInv = g("opening_inventory");
  const purchases = g("purchases");
  const subtotal = openingInv + purchases;
  const closingInv = -g("closing_inventory"); // 貸方残高の科目
  const cost = subtotal - closingInv;
  const gross = sales - cost;

  const expenses: PLLine[] = EXPENSE_LINES.map((l) => ({ no: l.no, label: l.label, amount: g(l.key) }));
  custom.sort((a, b) => b.amount - a.amount);
  let misc_exp = g("misc");
  custom.forEach((c, i) => {
    if (i < CUSTOM_SLOTS.length) expenses.push({ no: CUSTOM_SLOTS[i], label: c.label, amount: c.amount });
    else misc_exp += c.amount; // 任意科目欄が足りない分は雑費へ合算
  });
  for (let i = custom.length; i < CUSTOM_SLOTS.length; i++) expenses.push({ no: CUSTOM_SLOTS[i], label: "", amount: 0 });
  expenses.push({ no: "㉛", label: "雑費", amount: misc_exp });

  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);
  const operating = gross - totalExp;
  const before = operating; // 各種引当金・準備金等は未対応（0 円）
  const deduction = before > 0 ? Math.min(blueDeductionLimit, before) : 0;
  return {
    sales,
    sales_only: salesOnly,
    misc_income: misc,
    opening_inventory: openingInv,
    purchases,
    subtotal,
    closing_inventory: closingInv,
    cost_of_sales: cost,
    gross_profit: gross,
    expenses,
    total_expenses: totalExp,
    operating_income: operating,
    income_before_deduction: before,
    blue_deduction: deduction,
    income: before - deduction,
  };
}

export interface BalanceSheetRow {
  label: string;
  opening: number;
  closing: number;
}

export interface BalanceSheet {
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[]; // 負債・資本（事業主借・元入金・所得 含む）
  total_assets: { opening: number; closing: number };
  total_liabilities: { opening: number; closing: number };
}

export function buildBalanceSheet(balances: AccountBalance[], incomeBeforeDeduction: number): BalanceSheet {
  const rows = (cat: Account["category"][]) =>
    balances
      .filter((b) => cat.includes(b.account.category))
      .filter((b) => b.opening !== 0 || b.closing !== 0 || b.account.is_system)
      .sort((x, y) => x.account.sort_order - y.account.sort_order)
      .map((b) => ({ label: b.account.name, opening: b.opening, closing: b.closing }));
  const assets = rows(["asset"]);
  const liabilities = [
    ...rows(["liability", "equity"]),
    { label: "青色申告特別控除前の所得金額", opening: 0, closing: incomeBeforeDeduction },
  ];
  const sum = (rs: BalanceSheetRow[]) => ({
    opening: rs.reduce((s, r) => s + r.opening, 0),
    closing: rs.reduce((s, r) => s + r.closing, 0),
  });
  return { assets, liabilities, total_assets: sum(assets), total_liabilities: sum(liabilities) };
}

/**
 * 翌年の期首残高を計算する。
 * 事業主貸・事業主借は元入金に振り替え、元入金 = 期末の資産合計 - 負債合計（事業主貸借除く）。
 */
export function carryForward(balances: AccountBalance[], ownerDrawId: number, ownerContribId: number, capitalId: number): Map<number, number> {
  const next = new Map<number, number>();
  let assets = 0;
  let liabilities = 0;
  for (const b of balances) {
    const a = b.account;
    if (a.id === ownerDrawId || a.id === ownerContribId || a.id === capitalId) continue;
    if (a.category === "asset") {
      assets += b.closing;
      if (b.closing !== 0) next.set(a.id, b.closing);
    } else if (a.category === "liability" || a.category === "equity") {
      liabilities += b.closing;
      if (b.closing !== 0) next.set(a.id, b.closing);
    }
  }
  next.set(capitalId, assets - liabilities);
  return next;
}
