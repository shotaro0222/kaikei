import type { Direction, LineInput, TaxCategory } from "./types";

export interface QuickEntry {
  direction: Direction;
  amount: number;
  account_id: number; // 費用・収益側の科目
  counter_account_id: number; // 支払元・入金先（現金・普通預金・未払金・事業主借 等）
  tax_category: TaxCategory;
  /** 入力時按分（timing=entry）の事業割合。undefined なら按分しない */
  business_ratio?: number;
  owner_draw_id: number; // 事業主貸
  owner_contrib_id: number; // 事業主借
}

export function businessPortion(amount: number, ratio: number): number {
  return Math.round((amount * ratio) / 100);
}

/**
 * かんたん入力から仕訳明細を組み立てる。
 * 家事按分（入力時）:
 *   事業用口座から支払 → (借)経費 事業分 / (借)事業主貸 私用分 / (貸)支払元 全額
 *   私費（事業主借）で支払 → (借)経費 事業分 / (貸)事業主借 事業分（私用分は記帳しない）
 */
export function buildQuickLines(e: QuickEntry): LineInput[] {
  if (!Number.isInteger(e.amount) || e.amount <= 0) throw new Error("金額は1円以上の整数で入力してください");

  if (e.direction === "income") {
    return [
      { side: "debit", account_id: e.counter_account_id, amount: e.amount, tax_category: "out" },
      { side: "credit", account_id: e.account_id, amount: e.amount, tax_category: e.tax_category },
    ];
  }

  const ratio = e.business_ratio;
  if (ratio === undefined || ratio >= 100 || e.account_id === e.owner_draw_id) {
    return [
      { side: "debit", account_id: e.account_id, amount: e.amount, tax_category: e.tax_category },
      { side: "credit", account_id: e.counter_account_id, amount: e.amount, tax_category: "out" },
    ];
  }

  const biz = businessPortion(e.amount, ratio);
  const priv = e.amount - biz;

  if (e.counter_account_id === e.owner_contrib_id) {
    if (biz === 0) throw new Error("事業割合が0%のため記帳不要です（私費での私的支出）");
    return [
      { side: "debit", account_id: e.account_id, amount: biz, tax_category: e.tax_category, memo: `家事按分 事業${ratio}%` },
      { side: "credit", account_id: e.counter_account_id, amount: biz, tax_category: "out" },
    ];
  }

  const lines: LineInput[] = [];
  if (biz > 0) lines.push({ side: "debit", account_id: e.account_id, amount: biz, tax_category: e.tax_category, memo: `家事按分 事業${ratio}%` });
  if (priv > 0) lines.push({ side: "debit", account_id: e.owner_draw_id, amount: priv, tax_category: "out", memo: "家事按分 私用分" });
  lines.push({ side: "credit", account_id: e.counter_account_id, amount: e.amount, tax_category: "out" });
  return lines;
}

/** 貸借一致・金額の妥当性を検証。エラーメッセージを返す（問題なければ null） */
export function validateLines(lines: LineInput[]): string | null {
  if (!Array.isArray(lines) || lines.length < 2) return "仕訳明細は2行以上必要です";
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    if (l.side !== "debit" && l.side !== "credit") return "借方/貸方の指定が不正です";
    if (!Number.isInteger(l.account_id)) return "勘定科目が未選択の行があります";
    if (!Number.isInteger(l.amount) || l.amount < 0) return "金額は0以上の整数で入力してください";
    if (l.side === "debit") dr += l.amount;
    else cr += l.amount;
  }
  if (dr === 0) return "金額が0円です";
  if (dr !== cr) return `貸借が一致しません（借方 ${dr.toLocaleString()} / 貸方 ${cr.toLocaleString()}）`;
  return null;
}

/** 消費税額（税込金額から割り戻し。1円未満切捨て） */
export function includedTax(amount: number, tax: TaxCategory): number {
  if (tax === "taxable10") return Math.floor((amount * 10) / 110);
  if (tax === "taxable8") return Math.floor((amount * 8) / 108);
  return 0;
}
