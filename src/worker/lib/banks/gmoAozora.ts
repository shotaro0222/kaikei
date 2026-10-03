import type { BankCredentials, BankProvider, BankTransaction } from "./types";

/**
 * GMOあおぞらネット銀行 API 連携。
 * - 本番: OAuth2（認可コード）で取得したアクセストークンを使用
 * - sunabar（API実験場）: ポータルで発行されたトークンを直接登録して利用可能
 * API仕様: https://gmo-aozora.com/business/service/api-banking.html
 */
export interface GmoConfig {
  apiBase: string; // 例: https://api.gmo-aozora.com/ganb/api/personal/v1
  authBase: string; // 例: https://api.gmo-aozora.com/ganb/api/auth/v1
  clientId?: string;
  clientSecret?: string;
}

interface GmoTransaction {
  transactionDate: string;
  valueDate?: string;
  transactionType: string; // "1": 入金, "2": 出金
  amount: string;
  remarks?: string;
  balance?: string;
  itemKey?: string;
}

async function call<T>(cfg: GmoConfig, cred: BankCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(cfg.apiBase.replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-access-token": cred.access_token, Accept: "application/json;charset=UTF-8" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GMOあおぞらネット銀行 API エラー ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function gmoAuthorizeUrl(cfg: GmoConfig, redirectUri: string, state: string): string {
  const u = new URL(cfg.authBase.replace(/\/$/, "") + "/authorization");
  u.searchParams.set("client_id", cfg.clientId ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "private:account");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(cfg: GmoConfig, body: Record<string, string>): Promise<BankCredentials> {
  const res = await fetch(cfg.authBase.replace(/\/$/, "") + "/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${cfg.clientId}:${cfg.clientSecret}`),
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`トークン取得に失敗しました (${res.status})`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
  };
}

export function gmoExchangeCode(cfg: GmoConfig, code: string, redirectUri: string): Promise<BankCredentials> {
  return tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function parseGmoTransactions(list: GmoTransaction[]): BankTransaction[] {
  return list.map((t) => {
    const amt = Number(t.amount);
    return {
      external_id: t.itemKey ?? null,
      date: t.transactionDate.slice(0, 10),
      description: (t.remarks ?? "").trim() || (t.transactionType === "1" ? "入金" : "出金"),
      amount: t.transactionType === "1" ? amt : -amt,
      balance: t.balance != null && t.balance !== "" ? Number(t.balance) : null,
    };
  });
}

export function gmoAozoraProvider(cfg: GmoConfig): BankProvider {
  return {
    id: "gmo_aozora",
    label: "GMOあおぞらネット銀行",
    async listAccounts(cred) {
      const j = await call<{ accounts: Array<{ accountId: string; branchName?: string; accountTypeName?: string; accountNumber?: string; nickname?: string }> }>(cfg, cred, "/accounts");
      return (j.accounts ?? []).map((a) => ({
        id: a.accountId,
        label: [a.nickname, a.branchName, a.accountTypeName, a.accountNumber].filter(Boolean).join(" "),
      }));
    },
    async fetchTransactions(cred, accountId, from, to) {
      const out: BankTransaction[] = [];
      let nextItemKey: string | undefined;
      // ページング（hasNext / nextItemKey）
      for (let page = 0; page < 50; page++) {
        const params: Record<string, string> = { accountId, dateFrom: from, dateTo: to };
        if (nextItemKey) params.nextItemKey = nextItemKey;
        const j = await call<{ transactions?: GmoTransaction[]; hasNext?: boolean; nextItemKey?: string }>(cfg, cred, "/accounts/transactions", params);
        out.push(...parseGmoTransactions(j.transactions ?? []));
        if (!j.hasNext || !j.nextItemKey) break;
        nextItemKey = j.nextItemKey;
      }
      return out;
    },
    async refresh(cred) {
      if (!cred.refresh_token || !cfg.clientId) return cred;
      return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: cred.refresh_token });
    },
  };
}
