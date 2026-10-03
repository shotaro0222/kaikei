import { describe, expect, it } from "vitest";
import { classify, parseAiAnswer, ruleMatches } from "../src/worker/lib/classifier";
import { learningKey, normalizeText } from "../src/worker/lib/normalize";
import type { ClassificationRule } from "../src/worker/lib/types";
import { A, ACCOUNTS } from "./fixtures";

function rule(p: Partial<ClassificationRule>): ClassificationRule {
  return { id: 1, keyword: "", match_type: "contains", direction: "any", account_id: A["雑費"], tax_category: null, partner: null, priority: 0, kind: "user", hits: 0, ...p };
}

describe("normalize", () => {
  it("全角半角・ひらがなカタカナを吸収する", () => {
    expect(normalizeText("ａｍａｚｏｎ　でんき")).toBe("AMAZON デンキ");
  });
  it("学習キーは日付や番号を除去する", () => {
    expect(learningKey("カ)アマゾン 2025/01/05 12345678")).toBe(learningKey("カ)アマゾン 2025/02/11 99990000"));
  });
});

describe("classify", () => {
  it("組込み辞書から推定する", () => {
    const s = classify("東京電力 1月分", "expense", [], ACCOUNTS);
    expect(s.account_id).toBe(A["水道光熱費"]);
    expect(s.source).toBe("dictionary");
  });

  it("より長いキーワードを優先する（AMAZON WEB SERVICES は通信費）", () => {
    expect(classify("Amazon Web Services", "expense", [], ACCOUNTS).account_id).toBe(A["通信費"]);
    expect(classify("Amazon 文房具", "expense", [], ACCOUNTS).account_id).toBe(A["消耗品費"]);
  });

  it("ユーザールールが辞書より優先される", () => {
    const rules = [rule({ keyword: "スターバックス", account_id: A["新聞図書費"] })];
    expect(classify("スターバックス 渋谷", "expense", rules, ACCOUNTS).account_id).toBe(A["新聞図書費"]);
  });

  it("学習ルールは完全一致（番号違いも同一視）で最優先", () => {
    const rules = [
      rule({ id: 1, keyword: "カード", account_id: A["雑費"], kind: "user" }),
      rule({ id: 2, keyword: learningKey("ミツイスミトモカード 0105"), match_type: "exact", direction: "expense", account_id: A["未払金"], kind: "learned" }),
    ];
    const s = classify("ミツイスミトモカード 0210", "expense", rules, ACCOUNTS);
    expect(s.account_id).toBe(A["未払金"]);
    expect(s.source).toBe("learned");
  });

  it("収支区分が違うルールは使わない", () => {
    const rules = [rule({ keyword: "STRIPE", direction: "income", account_id: A["売上高"] })];
    expect(classify("STRIPE FEE", "expense", rules, ACCOUNTS).account_id).not.toBe(A["売上高"]);
  });

  it("該当なしは確度の低いフォールバック", () => {
    const s = classify("よくわからない支出", "expense", [], ACCOUNTS);
    expect(s.account_id).toBe(A["雑費"]);
    expect(s.confidence).toBeLessThan(0.5);
    expect(classify("謎の入金", "income", [], ACCOUNTS).account_id).toBe(A["売上高"]);
  });

  it("正規表現ルール", () => {
    expect(ruleMatches({ keyword: "^JR.*定期", match_type: "regex" }, "JR東日本 定期券")).toBe(true);
    expect(ruleMatches({ keyword: "([", match_type: "regex" }, "x")).toBe(false);
  });
});

describe("parseAiAnswer", () => {
  it("JSON 形式の回答を解釈", () => {
    expect(parseAiAnswer('{"account":"会議費","reason":"打合せ"}', ACCOUNTS)?.account.id).toBe(A["会議費"]);
  });
  it("壊れた回答からも科目名を拾う", () => {
    expect(parseAiAnswer("おそらく旅費交通費です", ACCOUNTS)?.account.id).toBe(A["旅費交通費"]);
    expect(parseAiAnswer("不明", ACCOUNTS)).toBeNull();
  });
});
