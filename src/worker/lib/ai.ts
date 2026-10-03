import type { Env } from "../env";
import type { Account, Direction } from "./types";
import { buildAiPrompt, parseAiAnswer, type Suggestion } from "./classifier";

/** Workers AI で勘定科目を推定する。失敗時は null（ルールベースの結果をそのまま使う） */
export async function aiClassify(env: Env, text: string, direction: Direction, amount: number, accounts: Account[]): Promise<Suggestion | null> {
  if (!env.AI) return null;
  try {
    const model = (env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast") as Parameters<Ai["run"]>[0];
    const out = (await env.AI.run(model, {
      messages: [{ role: "user", content: buildAiPrompt(text, direction, amount, accounts) }],
      max_tokens: 120,
      temperature: 0,
    } as never)) as { response?: string } | string;
    const answer = typeof out === "string" ? out : out?.response ?? "";
    const parsed = parseAiAnswer(String(answer), accounts);
    if (!parsed) return null;
    return {
      account_id: parsed.account.id,
      tax_category: parsed.account.tax_default,
      partner: null,
      confidence: 0.6,
      source: "ai",
      reason: `AI推定${parsed.reason ? `: ${parsed.reason}` : ""}`,
    };
  } catch (e) {
    console.warn("AI classify failed", e);
    return null;
  }
}
