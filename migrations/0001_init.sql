-- 個人事業主向け会計 スキーマ

-- 事業者設定（key-value）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 勘定科目
-- category: asset / liability / equity / revenue / expense
-- report_line: 青色申告決算書・収支内訳書の行キー（lib/taxReturn.ts 参照）
CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN ('asset','liability','equity','revenue','expense')),
  report_line TEXT,
  tax_default TEXT NOT NULL DEFAULT 'out',
  is_system   INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 仕訳ヘッダ
-- source: manual / quick / bank / csv / depreciation / apportion / inventory / opening / closing
CREATE TABLE journals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,          -- YYYY-MM-DD
  description TEXT NOT NULL DEFAULT '',
  partner     TEXT,
  memo        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  source_ref  TEXT,                   -- 決算整理仕訳の再生成キーなど
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_journals_date ON journals(date);
CREATE INDEX idx_journals_source ON journals(source, source_ref);

-- 仕訳明細（借方/貸方）
-- tax_category: taxable10 / taxable8 / exempt(非課税) / out(不課税・対象外) / export(輸出免税)
CREATE TABLE journal_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id   INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  side         TEXT NOT NULL CHECK (side IN ('debit','credit')),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount       INTEGER NOT NULL CHECK (amount >= 0),
  tax_category TEXT NOT NULL DEFAULT 'out',
  memo         TEXT
);
CREATE INDEX idx_lines_journal ON journal_lines(journal_id);
CREATE INDEX idx_lines_account ON journal_lines(account_id);

-- 自動仕訳ルール
-- kind: system（組込み辞書） / user（手動登録） / learned（確定した仕訳から学習）
-- direction: expense（支出） / income（収入） / any
CREATE TABLE classification_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword      TEXT NOT NULL,
  match_type   TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains','exact','prefix','regex')),
  direction    TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('expense','income','any')),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  tax_category TEXT,
  partner      TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL DEFAULT 'user',
  hits         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (keyword, match_type, direction)
);

-- 家事按分ルール
-- timing: entry（仕訳入力時に自動分割） / year_end（決算時にまとめて振替）
CREATE TABLE apportion_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
  business_ratio INTEGER NOT NULL CHECK (business_ratio BETWEEN 0 AND 100),
  timing         TEXT NOT NULL DEFAULT 'year_end' CHECK (timing IN ('entry','year_end')),
  basis          TEXT,   -- 按分根拠（例: 床面積 20㎡/60㎡）
  active         INTEGER NOT NULL DEFAULT 1
);

-- 電子領収書・請求書（電子帳簿保存法の検索要件: 取引年月日・金額・取引先）
CREATE TABLE receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  storage      TEXT NOT NULL DEFAULT 'r2' CHECK (storage IN ('r2','external')),
  r2_key       TEXT,
  external_url TEXT,
  file_name    TEXT NOT NULL,
  mime_type    TEXT,
  size         INTEGER,
  sha256       TEXT,
  doc_type     TEXT NOT NULL DEFAULT 'receipt', -- receipt / invoice / quote / contract / other
  issued_date  TEXT,
  amount       INTEGER,
  partner      TEXT,
  memo         TEXT,
  journal_id   INTEGER REFERENCES journals(id) ON DELETE SET NULL,
  source       TEXT NOT NULL DEFAULT 'upload',  -- upload / email / link
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);
CREATE INDEX idx_receipts_search ON receipts(issued_date, amount, partner);
CREATE INDEX idx_receipts_journal ON receipts(journal_id);

-- 口座（銀行・クレジットカード・電子マネー・現金）
-- provider: manual / csv / gmo_aozora
CREATE TABLE bank_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'bank' CHECK (kind IN ('bank','card','ewallet','cash')),
  account_id      INTEGER NOT NULL REFERENCES accounts(id), -- 対応する勘定科目（普通預金・未払金 等）
  provider        TEXT NOT NULL DEFAULT 'csv',
  provider_config TEXT,      -- JSON（外部口座ID等）
  credentials     TEXT,      -- AES-GCM で暗号化したトークン
  csv_mapping     TEXT,      -- JSON（前回のCSV列割当）
  last_synced_at  TEXT,
  active          INTEGER NOT NULL DEFAULT 1
);

-- 取込明細
-- amount: 入金はプラス、出金はマイナス
CREATE TABLE bank_transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id  INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  description      TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  balance          INTEGER,
  external_id      TEXT,
  dedup_key        TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'unprocessed' CHECK (status IN ('unprocessed','journaled','ignored')),
  journal_id       INTEGER REFERENCES journals(id) ON DELETE SET NULL,
  imported_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bank_tx_status ON bank_transactions(status, date);

-- 固定資産台帳
-- method: straight_line（定額法） / lump_sum（一括償却資産・3年均等） / immediate（少額減価償却資産の特例）
CREATE TABLE fixed_assets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  account_id       INTEGER NOT NULL REFERENCES accounts(id),
  quantity         INTEGER NOT NULL DEFAULT 1,
  acquisition_date TEXT NOT NULL,
  service_date     TEXT,              -- 事業供用日（未入力なら取得日）
  acquisition_cost INTEGER NOT NULL,
  useful_life      INTEGER NOT NULL DEFAULT 1,
  method           TEXT NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line','lump_sum','immediate')),
  business_ratio   INTEGER NOT NULL DEFAULT 100 CHECK (business_ratio BETWEEN 0 AND 100),
  opening_accumulated INTEGER NOT NULL DEFAULT 0, -- 本システム導入前の償却累計額
  disposal_date    TEXT,
  memo             TEXT
);

-- 期首残高（年度ごと）
CREATE TABLE opening_balances (
  fiscal_year INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  amount      INTEGER NOT NULL,  -- 資産は借方残、負債・資本は貸方残をプラスで保持
  PRIMARY KEY (fiscal_year, account_id)
);

-- 年度別の申告用入力値（棚卸高・所得控除・源泉徴収税額など）
CREATE TABLE year_inputs (
  fiscal_year INTEGER NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (fiscal_year, key)
);

-- 訂正・削除履歴（電子帳簿保存法対応）
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL DEFAULT (datetime('now')),
  action     TEXT NOT NULL,   -- create / update / delete
  entity     TEXT NOT NULL,   -- journal / receipt / ...
  entity_id  INTEGER,
  before_json TEXT,
  after_json  TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
