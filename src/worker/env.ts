export interface Env {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  AI?: Ai;
  ASSETS?: Fetcher;
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
  ENCRYPTION_KEY?: string;
  AI_MODEL?: string;
  GMO_AOZORA_API_BASE?: string;
  GMO_AOZORA_AUTH_BASE?: string;
  GMO_AOZORA_CLIENT_ID?: string;
  GMO_AOZORA_CLIENT_SECRET?: string;
}

export type AppEnv = { Bindings: Env };
