import type { Account, ClassificationRule, Direction, TaxCategory } from "./types";
import { normalizeText, learningKey } from "./normalize";
import { matchDictionary } from "./dictionary";

export interface Suggestion {
  account_id: number;
  tax_category: TaxCategory;
  partner: string | null;
  confidence: number; // 0〜1
  source: "learned" | "user" | "dictionary" | "ai" | "fallback";
  reason: string;
  rule_id?: number;
}

export function ruleMatches(rule: Pick<ClassificationRule, "keyword" | "match_type">, text: string): boolean {
  const t = normalizeText(text);
  const k = normalizeText(rule.keyword);
  if (!k) return false;
  switch (rule.match_type) {
    case "exact":
      return t === k || learningKey(text) === k;
    case "prefix":
      return t.startsWith(k);
    case "regex":
      try {
        return new RegExp(rule.keyword, "i").test(text.normalize("NFKC"));
      } catch {
        return false;
      }
    default:
      return t.includes(k);
  }
}

/**
 * ルールベースで勘定科目を推定する。
 * 優先順位: 学習ルール(完全一致) > ユーザールール(priority, キーワード長) > 組込み辞書 > フォールバック
 * 戻り値が confidence < 0.5 の場合、呼び出し側で AI 推定を試みる。
 */
export function classify(
  text: string,
  direction: Direction,
  rules: ClassificationRule[],
  accounts: Account[],
): Suggestion {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byName = new Map(accounts.map((a) => [a.name, a]));

  const candidates = rules
    .filter((r) => (r.direction === "any" || r.direction === direction) && byId.get(r.account_id)?.active)
    .filter((r) => ruleMatches(r, text))
    .map((r) => ({
      r,
      score:
        r.priority * 10000 +
        (r.kind === "learned" && r.match_type === "exact" ? 5000 : 0) +
        (r.kind === "user" ? 2000 : 0) +
        normalizeText(r.keyword).length * 10 +
        Math.min(r.hits, 9),
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    const { r } = candidates[0];
    const acc = byId.get(r.account_id)!;
    return {
      account_id: acc.id,
      tax_category: r.tax_category ?? acc.tax_default,
      partner: r.partner,
      confidence: r.kind === "learned" ? 0.95 : 0.9,
      source: r.kind,
      reason: `${r.kind === "learned" ? "過去の仕訳から学習" : "登録ルール"}「${r.keyword}」に一致`,
      rule_id: r.id,
    };
  }

  const dict = matchDictionary(text, direction);
  if (dict) {
    const acc = byName.get(dict.account);
    if (acc && acc.active) {
      return {
        account_id: acc.id,
        tax_category: dict.tax ?? acc.tax_default,
        partner: null,
        confidence: normalizeText(dict.keyword).length >= 3 ? 0.8 : 0.6,
        source: "dictionary",
        reason: `キーワード「${dict.keyword}」から推定`,
      };
    }
  }

  const fallbackName = direction === "income" ? "売上高" : "雑費";
  const fb = byName.get(fallbackName) ?? accounts.find((a) => a.category === (direction === "income" ? "revenue" : "expense"));
  if (!fb) throw new Error("勘定科目が未設定です");
  return {
    account_id: fb.id,
    tax_category: fb.tax_default,
    partner: null,
    confidence: 0.2,
    source: "fallback",
    reason: "該当ルールなし（仮の科目）",
  };
}

/** AI へ渡すプロンプトを作る（Workers AI 用） */
export function buildAiPrompt(text: string, direction: Direction, amount: number, accounts: Account[]): string {
  const names = accounts
    .filter((a) => a.active && (direction === "income" ? a.category === "revenue" : a.category === "expense" || a.name === "事業主貸"))
    .map((a) => a.name);
  return [
    "あなたは日本の個人事業主の記帳を手伝う会計アシスタントです。",
    `次の${direction === "income" ? "収入" : "支出"}取引に最も適切な勘定科目を、候補の中から1つだけ選んでください。`,
    "事業に関係しない私的な支出の場合は「事業主貸」を選んでください。",
    `取引内容: ${text}`,
    `金額: ${amount}円`,
    `候補: ${names.join("、")}`,
    '回答は JSON のみで {"account":"科目名","reason":"20文字以内の理由"} の形式で出力してください。',
  ].join("\n");
}

export function parseAiAnswer(answer: string, accounts: Account[]): { account: Account; reason: string } | null {
  const m = answer.match(/\{[\s\S]*?\}/);
  let name: string | undefined;
  let reason = "";
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      name = typeof j.account === "string" ? j.account.trim() : undefined;
      reason = typeof j.reason === "string" ? j.reason : "";
    } catch {
      /* fallthrough */
    }
  }
  const active = accounts.filter((a) => a.active);
  let acc = name ? active.find((a) => a.name === name) : undefined;
  if (!acc) {
    // JSON が壊れていても、回答中に現れる最長の科目名を拾う
    acc = [...active].sort((a, b) => b.name.length - a.name.length).find((a) => answer.includes(a.name));
  }
  return acc ? { account: acc, reason } : null;
}
