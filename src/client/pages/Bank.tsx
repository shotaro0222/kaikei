import { useEffect, useState } from "react";
import { api, qs, readTextAuto } from "../api";
import { useApp, useFetch, useRoute } from "../app";
import { AccountSelect, AmountInput, Confidence, ErrorBox, Field, Modal, TaxSelect, useAccountName } from "../components";
import { today, yen } from "../format";
import type { Suggestion, TaxCategory } from "../types";

interface BankAccount {
  id: number;
  name: string;
  kind: "bank" | "card" | "ewallet" | "cash";
  account_id: number;
  provider: string;
  provider_config: string | null;
  connected: number;
  unprocessed: number;
  last_balance: number | null;
  last_synced_at: string | null;
}

interface BankTx {
  id: number;
  bank_account_id: number;
  bank_name: string;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  status: string;
  journal_id: number | null;
  suggestion: Suggestion | null;
}

const KIND_LABEL = { bank: "銀行口座", card: "クレジットカード", ewallet: "電子マネー・QR決済", cash: "現金" };
const PROVIDER_LABEL: Record<string, string> = { csv: "CSV取込", gmo_aozora: "GMOあおぞらネット銀行 API", manual: "手入力" };

export function BankPage() {
  const { refreshCounts, toast } = useApp();
  const { params } = useRoute();
  const name = useAccountName();
  const accounts = useFetch<BankAccount[]>("/bank-accounts");
  const [status, setStatus] = useState("unprocessed");
  const [filterBa, setFilterBa] = useState<number | "">("");
  const txs = useFetch<BankTx[]>(`/bank-transactions${qs({ status, bank_account_id: filterBa })}`);
  const [adding, setAdding] = useState(false);
  const [csvFor, setCsvFor] = useState<BankAccount | null>(null);
  const [apiFor, setApiFor] = useState<BankAccount | null>(null);
  const [manualFor, setManualFor] = useState<BankAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const o = params.get("oauth");
    if (o === "ok") toast("銀行APIの認証が完了しました");
    else if (o) setError("銀行APIの認証に失敗しました。もう一度お試しください。");
  }, [params, toast]);

  const reloadAll = () => {
    accounts.reload();
    txs.reload();
    refreshCounts();
  };

  const auto = async () => {
    try {
      const r = await api.post<{ journaled: number; skipped: number }>("/bank-transactions/auto", { min_confidence: 0.8 });
      toast(`${r.journaled}件を自動仕訳しました（確認が必要: ${r.skipped}件）`);
      reloadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sync = async (ba: BankAccount) => {
    try {
      const r = await api.post<{ imported: number; duplicates: number }>(`/bank-accounts/${ba.id}/sync`);
      toast(`${r.imported}件の明細を取得しました（重複 ${r.duplicates}件）`);
      reloadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className="row between">
        <h1>銀行・カード明細</h1>
        <button className="primary" onClick={() => setAdding(true)}>
          ＋ 口座・カードを追加
        </button>
      </div>
      <ErrorBox error={error || accounts.error} />
      <div className="grid grid-3">
        {accounts.data?.map((ba) => (
          <div className="card" key={ba.id}>
            <div className="row between">
              <b>{ba.name}</b>
              <span className="tag">{KIND_LABEL[ba.kind]}</span>
            </div>
            <div className="muted small">
              勘定科目: {name(ba.account_id)} ／ {PROVIDER_LABEL[ba.provider] ?? ba.provider}
              {ba.provider === "gmo_aozora" && (ba.connected ? " ✅接続済み" : " ⚠未接続")}
            </div>
            {ba.last_balance != null && <div className="small">明細残高: ¥{yen(ba.last_balance)}</div>}
            {ba.last_synced_at && <div className="muted small">最終取込: {ba.last_synced_at}(UTC)</div>}
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => setCsvFor(ba)}>CSV取込</button>
              {ba.provider === "gmo_aozora" && ba.connected ? <button onClick={() => sync(ba)}>API同期</button> : null}
              <button onClick={() => setManualFor(ba)}>手入力</button>
              <button className="link" onClick={() => setApiFor(ba)}>設定</button>
            </div>
            {ba.unprocessed > 0 && <div className="small" style={{ marginTop: 6 }}>未処理 <b>{ba.unprocessed}</b>件</div>}
          </div>
        ))}
        {accounts.data?.length === 0 && (
          <div className="card muted">
            口座・カードを登録すると、CSVファイルや銀行APIで明細を取り込んで自動仕訳できます。
          </div>
        )}
      </div>

      <div className="row between" style={{ marginTop: 10 }}>
        <div className="row">
          <div className="seg">
            {[
              ["unprocessed", "未処理"],
              ["journaled", "仕訳済み"],
              ["ignored", "対象外"],
            ].map(([k, l]) => (
              <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>
                {l}
              </button>
            ))}
          </div>
          <select value={filterBa} onChange={(e) => setFilterBa(e.target.value ? Number(e.target.value) : "")}>
            <option value="">すべての口座</option>
            {accounts.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {status === "unprocessed" && (txs.data?.length ?? 0) > 0 && (
          <button className="primary" onClick={auto} title="学習・ルール・辞書で確度の高いものだけを仕訳します">
            確度の高い明細を一括仕訳
          </button>
        )}
      </div>
      <div className="card table-wrap" style={{ padding: 0, marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>口座</th>
              <th>摘要</th>
              <th className="num">入金</th>
              <th className="num">出金</th>
              <th style={{ minWidth: 320 }}>{status === "unprocessed" ? "勘定科目（推定）" : "状態"}</th>
            </tr>
          </thead>
          <tbody>
            {txs.data?.map((t) => (
              <TxRow key={t.id} tx={t} onDone={reloadAll} />
            ))}
            {txs.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {status === "unprocessed" ? "未処理の明細はありません 🎉" : "明細はありません"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && <AddAccountModal onClose={() => setAdding(false)} onSaved={() => (setAdding(false), accounts.reload())} />}
      {csvFor && <CsvImportModal ba={csvFor} onClose={() => setCsvFor(null)} onDone={() => (setCsvFor(null), reloadAll())} />}
      {apiFor && <SettingsModal ba={apiFor} onClose={() => setApiFor(null)} onSaved={() => (setApiFor(null), reloadAll())} />}
      {manualFor && <ManualTxModal ba={manualFor} onClose={() => setManualFor(null)} onSaved={() => (setManualFor(null), reloadAll())} />}
    </>
  );
}

function TxRow({ tx, onDone }: { tx: BankTx; onDone: () => void }) {
  const { accounts, toast } = useApp();
  const [accountId, setAccountId] = useState<number | "">(tx.suggestion?.account_id ?? "");
  const [tax, setTax] = useState<TaxCategory>(tx.suggestion?.tax_category ?? "out");
  const [sug, setSug] = useState(tx.suggestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(msg);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>{tx.date}</td>
      <td className="small">{tx.bank_name}</td>
      <td>{tx.description}</td>
      <td className="num pos">{tx.amount > 0 ? yen(tx.amount) : ""}</td>
      <td className="num">{tx.amount < 0 ? yen(-tx.amount) : ""}</td>
      <td>
        {tx.status === "unprocessed" ? (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 6 }}>
              <AccountSelect
                value={accountId}
                onChange={(id) => {
                  setAccountId(id);
                  setTax(accounts.find((a) => a.id === id)?.tax_default ?? "out");
                }}
              />
              <TaxSelect value={tax} onChange={setTax} />
              <button
                className="primary"
                disabled={busy || !accountId}
                onClick={() => act(() => api.post(`/bank-transactions/${tx.id}/journal`, { account_id: accountId, tax_category: tax }), "仕訳しました")}
              >
                仕訳
              </button>
            </div>
            <div className="row small" style={{ gap: 6 }}>
              {sug && <Confidence v={sug.confidence} source={sug.source} />}
              <span className="muted">{sug?.reason}</span>
              <span className="spacer" />
              <button
                className="link"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const s = await api.post<Suggestion>(`/bank-transactions/${tx.id}/ai-suggest`);
                    setSug(s);
                    setAccountId(s.account_id);
                    setTax(s.tax_category);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                AIに聞く
              </button>
              <button className="link" disabled={busy} onClick={() => act(() => api.post(`/bank-transactions/${tx.id}/status`, { status: "ignored" }), "対象外にしました")}>
                対象外
              </button>
            </div>
            <ErrorBox error={error} />
          </div>
        ) : tx.status === "journaled" ? (
          <a href={`#/journals?id=${tx.journal_id}`}>仕訳 #{tx.journal_id}</a>
        ) : (
          <button className="link" onClick={() => act(() => api.post(`/bank-transactions/${tx.id}/status`, { status: "unprocessed" }), "未処理に戻しました")}>
            未処理に戻す
          </button>
        )}
      </td>
    </tr>
  );
}

function AddAccountModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<BankAccount["kind"]>("bank");
  const [accountId, setAccountId] = useState<number | "">("");
  const [provider, setProvider] = useState("csv");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="口座・カードの追加"
      onClose={onClose}
      footer={
        <button
          className="primary"
          onClick={() =>
            api
              .post("/bank-accounts", { name, kind, account_id: accountId || undefined, provider })
              .then(onSaved)
              .catch((e) => setError(e.message))
          }
        >
          追加
        </button>
      }
    >
      <div className="stack">
        <Field label="名称">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 〇〇銀行 事業用 / 楽天カード" />
        </Field>
        <Field label="種類">
          <select value={kind} onChange={(e) => setKind(e.target.value as BankAccount["kind"])}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="対応する勘定科目（未選択なら 銀行→普通預金 / カード→未払金 / 現金→現金）">
          <AccountSelect value={accountId} onChange={setAccountId} categories={["asset", "liability", "equity"]} placeholder="自動" />
        </Field>
        <Field label="明細の取得方法">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="csv">CSVファイルを取り込む</option>
            <option value="gmo_aozora">GMOあおぞらネット銀行 API で自動取得</option>
            <option value="manual">手入力（現金出納帳など）</option>
          </select>
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

interface Mapping {
  header_row: number;
  date: number;
  description: number[];
  withdrawal?: number | null;
  deposit?: number | null;
  amount?: number | null;
  invert?: boolean;
  balance?: number | null;
}

interface Preview {
  rows: string[][];
  row_count: number;
  mapping: Mapping | null;
  detected: boolean;
  sample: Array<{ row: number; date: string; description: string; amount: number; balance: number | null }>;
  count: number;
  errors: Array<{ row: number; message: string }>;
}

function CsvImportModal({ ba, onClose, onDone }: { ba: BankAccount; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (t: string, m?: Mapping) => {
    try {
      const p = await api.post<Preview>(`/bank-accounts/${ba.id}/csv/preview`, { text: t, mapping: m });
      setPreview(p);
      if (!m) setMapping(p.mapping);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const headers = preview && mapping ? preview.rows[mapping.header_row] ?? [] : preview?.rows[0] ?? [];
  const colSelect = (value: number | null | undefined, onChange: (v: number | null) => void, allowNone = true) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
      {allowNone && <option value="">（なし）</option>}
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {i + 1}: {h || "(空)"}
        </option>
      ))}
    </select>
  );
  const setM = (patch: Partial<Mapping>) => {
    const m = { ...(mapping ?? { header_row: 0, date: 0, description: [] }), ...patch } as Mapping;
    setMapping(m);
    if (text) load(text, m);
  };

  return (
    <Modal
      title={`CSV取込: ${ba.name}`}
      onClose={onClose}
      footer={
        <button
          className="primary"
          disabled={!mapping || !preview?.count || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ imported: number; duplicates: number; errors: number }>(`/bank-accounts/${ba.id}/csv/import`, { text, mapping });
              toast(`${r.imported}件を取り込みました（重複スキップ ${r.duplicates}件）`);
              onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {preview?.count ?? 0}件を取り込む
        </button>
      }
    >
      <p className="muted small">
        銀行・カード会社のサイトからダウンロードした CSV を選択してください（Shift_JIS / UTF-8 自動判定）。列は自動判定されます。うまく判定できない場合は列を指定してください。同じ明細を再度取り込んでも重複登録されません。
      </p>
      <input
        type="file"
        accept=".csv,.txt,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const t = await readTextAuto(f);
          setText(t);
          load(t);
        }}
      />
      <ErrorBox error={error} />
      {preview && (
        <>
          {!preview.mapping && <div className="alert warn">列を自動判定できませんでした。下で列を指定してください。</div>}
          <div className="grid grid-3" style={{ marginTop: 10 }}>
            <Field label="ヘッダ行">
              <select value={mapping?.header_row ?? 0} onChange={(e) => setM({ header_row: Number(e.target.value) })}>
                {preview.rows.slice(0, 15).map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}行目: {r.slice(0, 4).join(" | ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="日付列">{colSelect(mapping?.date, (v) => setM({ date: v ?? 0 }), false)}</Field>
            <Field label="摘要列">{colSelect(mapping?.description?.[0], (v) => setM({ description: v == null ? [] : [v, ...(mapping?.description.slice(1) ?? [])] }))}</Field>
            <Field label="摘要列（追加・任意）">{colSelect(mapping?.description?.[1], (v) => setM({ description: [mapping?.description[0] ?? 0, ...(v == null ? [] : [v])] }))}</Field>
            <Field label="出金列">{colSelect(mapping?.withdrawal, (v) => setM({ withdrawal: v, amount: v != null ? null : mapping?.amount }))}</Field>
            <Field label="入金列">{colSelect(mapping?.deposit, (v) => setM({ deposit: v, amount: v != null ? null : mapping?.amount }))}</Field>
            <Field label="金額列（入出金が1列の場合）">{colSelect(mapping?.amount, (v) => setM({ amount: v, withdrawal: v != null ? null : mapping?.withdrawal, deposit: v != null ? null : mapping?.deposit }))}</Field>
            <Field label="金額の符号">
              <select value={mapping?.invert ? "1" : "0"} onChange={(e) => setM({ invert: e.target.value === "1" })}>
                <option value="0">プラス＝入金</option>
                <option value="1">プラス＝支払（カード明細）</option>
              </select>
            </Field>
            <Field label="残高列">{colSelect(mapping?.balance, (v) => setM({ balance: v }))}</Field>
          </div>
          <h3>プレビュー（{preview.count}件{preview.errors.length ? ` / 読み取れない行 ${preview.errors.length}件` : ""}）</h3>
          <div className="table-wrap" style={{ maxHeight: 280 }}>
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>摘要</th>
                  <th className="num">金額</th>
                  <th className="num">残高</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((t) => (
                  <tr key={t.row}>
                    <td>{t.date}</td>
                    <td>{t.description}</td>
                    <td className={`num ${t.amount > 0 ? "pos" : ""}`}>{yen(t.amount)}</td>
                    <td className="num">{yen(t.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.errors.length > 0 && <p className="muted small">{preview.errors.slice(0, 5).map((e) => `${e.row}行目: ${e.message}`).join(" / ")}</p>}
        </>
      )}
    </Modal>
  );
}

function SettingsModal({ ba, onClose, onSaved }: { ba: BankAccount; onClose: () => void; onSaved: () => void }) {
  const cfg = ba.provider_config ? (JSON.parse(ba.provider_config) as { api_base?: string; external_account_id?: string }) : {};
  const [name, setName] = useState(ba.name);
  const [accountId, setAccountId] = useState<number | "">(ba.account_id);
  const [provider, setProvider] = useState(ba.provider);
  const [apiBase, setApiBase] = useState(cfg.api_base ?? "");
  const [token, setToken] = useState("");
  const [ext, setExt] = useState(cfg.external_account_id ?? "");
  const [extList, setExtList] = useState<Array<{ id: string; label: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useApp();

  const save = async () => {
    try {
      await api.put(`/bank-accounts/${ba.id}`, { name, account_id: accountId, provider, provider_config: { api_base: apiBase, external_account_id: ext } });
      if (token.trim()) await api.post(`/bank-accounts/${ba.id}/token`, { access_token: token });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={`口座の設定: ${ba.name}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm("この口座と取り込んだ明細を削除しますか？（作成済みの仕訳は残ります）")) return;
              await api.del(`/bank-accounts/${ba.id}`);
              onSaved();
            }}
          >
            口座を削除
          </button>
          <span className="spacer" />
          <button className="primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="名称">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="勘定科目">
          <AccountSelect value={accountId} onChange={setAccountId} categories={["asset", "liability", "equity"]} />
        </Field>
        <Field label="明細の取得方法">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="csv">CSV取込</option>
            <option value="gmo_aozora">GMOあおぞらネット銀行 API</option>
            <option value="manual">手入力</option>
          </select>
        </Field>
        {provider === "gmo_aozora" && (
          <div className="card stack" style={{ background: "var(--bg)" }}>
            <b>銀行API連携</b>
            <p className="small muted" style={{ margin: 0 }}>
              本番: Workers のシークレットに GMO_AOZORA_CLIENT_ID / SECRET を設定後、下のボタンで銀行の認可画面へ進みます。
              <br />
              お試し（sunabar API実験場）: API URL に <code>https://api.sunabar.gmo-aozora.com/personal/v1</code> を入力し、ポータルで発行したトークンを貼り付けます。
            </p>
            <div className="row">
              <a className="btn" href={`/api/bank/oauth/gmo/start?bank_account_id=${ba.id}`}>
                銀行で認可する（OAuth）
              </a>
              {ba.connected ? (
                <button
                  className="link"
                  onClick={() => api.del(`/bank-accounts/${ba.id}/token`).then(() => toast("連携を解除しました"))}
                >
                  連携を解除
                </button>
              ) : null}
            </div>
            <Field label="API URL（空欄なら本番 個人口座 API）">
              <input type="url" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.gmo-aozora.com/ganb/api/personal/v1" />
            </Field>
            <Field label="アクセストークン（直接登録する場合。暗号化して保存）">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={ba.connected ? "登録済み（変更する場合のみ入力）" : ""} />
            </Field>
            <Field label="連携する口座">
              <div className="row">
                {extList ? (
                  <select value={ext} onChange={(e) => setExt(e.target.value)}>
                    <option value="">選択してください</option>
                    {extList.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label || x.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" value={ext} onChange={(e) => setExt(e.target.value)} placeholder="口座ID" />
                )}
                <button
                  disabled={!ba.connected}
                  onClick={async () => {
                    try {
                      await api.put(`/bank-accounts/${ba.id}`, { provider: "gmo_aozora", provider_config: { api_base: apiBase } });
                      setExtList(await api.get(`/bank-accounts/${ba.id}/external-accounts`));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  口座一覧を取得
                </button>
              </div>
            </Field>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function ManualTxModal({ ba, onClose, onSaved }: { ba: BankAccount; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [dir, setDir] = useState<"out" | "in">("out");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={`明細の手入力: ${ba.name}`}
      onClose={onClose}
      footer={
        <button
          className="primary"
          disabled={!amount}
          onClick={() =>
            api
              .post(`/bank-accounts/${ba.id}/transactions`, { date, description, amount: dir === "in" ? Number(amount) : -Number(amount) })
              .then(onSaved)
              .catch((e) => setError(e.message))
          }
        >
          追加
        </button>
      }
    >
      <div className="row">
        <div className="seg">
          <button className={dir === "out" ? "on" : ""} onClick={() => setDir("out")}>出金</button>
          <button className={dir === "in" ? "on" : ""} onClick={() => setDir("in")}>入金</button>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <AmountInput value={amount} onChange={setAmount} />
      </div>
      <Field label="摘要" style={{ marginTop: 10 }}>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
    </Modal>
  );
}
