import type { ApportionRule, LineInput } from "./types";
import { businessPortion } from "./journal";

export interface YearEndApportionLine {
  account_id: number;
  total: number; // 当年の按分前の借方純額
  business: number;
  private: number;
  ratio: number;
  lines: LineInput[];
}

/**
 * 決算時の家事按分振替。
 * 年間計上額 T のうち私用分 (T - 事業分) を (借)事業主貸 / (貸)経費 で振り替える。
 */
export function yearEndApportion(
  totals: Map<number, number>,
  rules: ApportionRule[],
  ownerDrawId: number,
  taxOf: (accountId: number) => LineInput["tax_category"] = () => "out",
): YearEndApportionLine[] {
  const out: YearEndApportionLine[] = [];
  for (const r of rules) {
    if (!r.active || r.timing !== "year_end") continue;
    const total = totals.get(r.account_id) ?? 0;
    if (total <= 0) continue;
    const business = businessPortion(total, r.business_ratio);
    const priv = total - business;
    if (priv <= 0) continue;
    out.push({
      account_id: r.account_id,
      total,
      business,
      private: priv,
      ratio: r.business_ratio,
      lines: [
        { side: "debit", account_id: ownerDrawId, amount: priv, tax_category: "out", memo: `家事按分 私用分 ${100 - r.business_ratio}%` },
        // 消費税の仕入税額も私用分だけ減らすため、経費側は元の税区分で戻す
        { side: "credit", account_id: r.account_id, amount: priv, tax_category: taxOf(r.account_id), memo: `家事按分 事業${r.business_ratio}%` },
      ],
    });
  }
  return out;
}
