export interface BankTransaction {
  external_id: string | null;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // 入金 +, 出金 -
  balance: number | null;
}

export interface BankCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
}

export interface BankProvider {
  id: string;
  label: string;
  /** 外部の口座一覧（口座選択用） */
  listAccounts(cred: BankCredentials): Promise<Array<{ id: string; label: string }>>;
  fetchTransactions(cred: BankCredentials, externalAccountId: string, from: string, to: string): Promise<BankTransaction[]>;
  refresh?(cred: BankCredentials): Promise<BankCredentials>;
}
