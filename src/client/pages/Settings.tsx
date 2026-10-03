import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp, useFetch } from "../app";
import { AmountInput, ErrorBox, Field, TaxSelect } from "../components";
import { CATEGORY_LABELS, TAX_LABELS, yen } from "../format";
import type { Category, TaxCategory } from "../types";

type Tab = "business" | "accounts" | "opening" | "data";

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("business");
  return (
    <>
      <h1>事業者設定</h1>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === "business" ? "on" : ""} onClick={() => setTab("business")}>事業者情報・申告区分</button>
        <button className={tab === "accounts" ? "on" : ""} onClick={() => setTab("accounts")}>勘定科目</button>
        <button className={tab === "opening" ? "on" : ""} onClick={() => setTab("opening")}>期首残高</button>
        <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>データ・連携</button>
      </div>
      {tab === "business" && <Business />}
      {tab === "accounts" && <Accounts />}
      {tab === "opening" && <Opening />}
      {tab === "data" && <DataTab />}
    </>
  );
}

function Business() {
  const { settings, reload, toast } = useApp();
  const [s, setS] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setS({ ...s, [k]: e.target.value });
  return (
    <div className="card stack">
      <div className="grid grid-2">
        <Field label="氏名"><input type="text" value={s.owner_name ?? ""} onChange={set("owner_name")} /></Field>
        <Field label="フリガナ"><input type="text" value={s.owner_kana ?? ""} onChange={set("owner_kana")} /></Field>
        <Field label="屋号"><input type="text" value={s.business_name ?? ""} onChange={set("business_name")} /></Field>
        <Field label="業種名"><input type="text" value={s.business_type ?? ""} onChange={set("business_type")} placeholder="例: ソフトウェア開発" /></Field>
        <Field label="住所"><input type="text" value={s.address ?? ""} onChange={set("address")} /></Field>
        <Field label="事業所所在地"><input type="text" value={s.business_address ?? ""} onChange={set("business_address")} /></Field>
        <Field label="電話番号"><input type="text" value={s.phone ?? ""} onChange={set("phone")} /></Field>
        <Field label="インボイス登録番号"><input type="text" value={s.invoice_no ?? ""} onChange={set("invoice_no")} placeholder="T1234567890123" /></Field>
      </div>
      <h3 style={{ margin: "8px 0 0" }}>申告区分</h3>
      <div className="grid grid-2">
        <Field label="所得税の申告">
          <select value={s.filing_type} onChange={set("filing_type")}>
            <option value="blue">青色申告（青色申告決算書）</option>
            <option value="white">白色申告（収支内訳書）</option>
          </select>
        </Field>
        {s.filing_type === "blue" && (
          <Field label="青色申告特別控除">
            <select value={s.blue_deduction} onChange={set("blue_deduction")}>
              <option value="650000">65万円（複式簿記＋e-Tax提出 または 優良な電子帳簿）</option>
              <option value="550000">55万円（複式簿記＋紙で提出）</option>
              <option value="100000">10万円（簡易簿記）</option>
            </select>
          </Field>
        )}
        <Field label="消費税">
          <select value={s.consumption_tax} onChange={set("consumption_tax")}>
            <option value="exempt">免税事業者</option>
            <option value="twenty_percent">課税事業者：2割特例（インボイス登録した小規模事業者）</option>
            <option value="simplified">課税事業者：簡易課税</option>
            <option value="general">課税事業者：本則課税</option>
          </select>
        </Field>
        {s.consumption_tax === "simplified" && (
          <Field label="簡易課税の事業区分">
            <select value={s.simplified_category} onChange={set("simplified_category")}>
              <option value="1">第1種（卸売業）90%</option>
              <option value="2">第2種（小売業）80%</option>
              <option value="3">第3種（製造業等）70%</option>
              <option value="4">第4種（飲食店等）60%</option>
              <option value="5">第5種（サービス業等）50%</option>
              <option value="6">第6種（不動産業）40%</option>
            </select>
          </Field>
        )}
        <Field label="AIによる自動仕訳の補助（Workers AI）">
          <select value={s.ai_enabled} onChange={set("ai_enabled")}>
            <option value="true">使う（ルールで判定できない場合のみ）</option>
            <option value="false">使わない</option>
          </select>
        </Field>
      </div>
      <ErrorBox error={error} />
      <div className="row end">
        <button
          className="primary"
          onClick={async () => {
            try {
              await api.put("/settings", s);
              await reload();
              toast("保存しました");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

function Accounts() {
  const { accounts, reload, toast } = useApp();
  const [form, setForm] = useState({ code: "", name: "", category: "expense" as Category, tax_default: "taxable10" as TaxCategory });
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
      toast("更新しました");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="card row">
        <Field label="コード"><input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={{ width: 80 }} /></Field>
        <Field label="科目名"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="区分">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
            {Object.entries(CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="既定の税区分"><TaxSelect value={form.tax_default} onChange={(t) => setForm({ ...form, tax_default: t })} /></Field>
        <button className="primary" style={{ alignSelf: "flex-end" }} onClick={() => act(() => api.post("/accounts", form))}>追加</button>
      </div>
      <p className="muted small">追加した費用科目は、決算書の任意科目欄（㉕〜㉚）に自動で割り当てられます（7つ目以降は雑費に合算）。</p>
      <ErrorBox error={error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>コード</th><th>科目名</th><th>区分</th><th>既定の税区分</th><th>状態</th><th /></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={a.active ? undefined : { opacity: 0.5 }}>
                <td>{a.code}</td>
                <td>{a.name}{a.is_system ? <span className="tag" style={{ marginLeft: 4 }}>標準</span> : null}</td>
                <td>{CATEGORY_LABELS[a.category]}</td>
                <td>
                  <TaxSelect value={a.tax_default} onChange={(t) => act(() => api.put(`/accounts/${a.id}`, { tax_default: t }))} />
                </td>
                <td>{a.active ? "使用中" : "無効"}</td>
                <td>
                  {!a.is_system && (
                    <>
                      <button className="link" onClick={() => act(() => api.put(`/accounts/${a.id}`, { active: !a.active }))}>{a.active ? "無効化" : "有効化"}</button>
                      <button className="link" onClick={() => confirm(`${a.name}を削除しますか？（使用中なら無効化されます）`) && act(() => api.del(`/accounts/${a.id}`))}>削除</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">税区分: {Object.values(TAX_LABELS).join("・")}</p>
    </>
  );
}

function Opening() {
  const { accounts, year, toast } = useApp();
  const { data, reload } = useFetch<Array<{ account_id: number; amount: number }>>(`/opening/${year}`, [year]);
  const [vals, setVals] = useState<Record<number, number | "">>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.map((d) => [d.account_id, d.amount])));
  }, [data]);
  const bsAccounts = accounts.filter((a) => ["asset", "liability", "equity"].includes(a.category) && a.name !== "事業主貸" && a.name !== "事業主借");
  const capital = accounts.find((a) => a.name === "元入金");
  const assets = bsAccounts.filter((a) => a.category === "asset").reduce((s, a) => s + (Number(vals[a.id]) || 0), 0);
  const liabilities = bsAccounts.filter((a) => a.category === "liability").reduce((s, a) => s + (Number(vals[a.id]) || 0), 0);
  const otherEquity = bsAccounts.filter((a) => a.category === "equity" && a.id !== capital?.id).reduce((s, a) => s + (Number(vals[a.id]) || 0), 0);
  const balancedCapital = assets - liabilities - otherEquity;

  return (
    <div className="card">
      <p className="muted">
        {year}年1月1日時点の残高を入力します。開業初年度は、事業用口座の残高や事業に持ち込んだ資産を入力してください。前年に本アプリで<a href="#/closing">繰越</a>した場合は自動で設定されています。
      </p>
      <div className="grid grid-2">
        {(["asset", "liability", "equity"] as Category[]).map((c) => (
          <div key={c}>
            <h3>{CATEGORY_LABELS[c]}</h3>
            <table>
              <tbody>
                {bsAccounts.filter((a) => a.category === c).map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td style={{ width: 160 }}>
                      {a.id === capital?.id ? (
                        <span className="row" style={{ gap: 4 }}>
                          <AmountInput value={vals[a.id] ?? ""} onChange={(v) => setVals({ ...vals, [a.id]: v })} />
                          <button className="link small" onClick={() => setVals({ ...vals, [a.id]: balancedCapital })} title="資産−負債で計算">自動</button>
                        </span>
                      ) : (
                        <AmountInput value={vals[a.id] ?? ""} onChange={(v) => setVals({ ...vals, [a.id]: v })} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p>
        資産合計 {yen(assets)} ／ 負債・資本合計 {yen(liabilities + otherEquity + (Number(capital && vals[capital.id]) || 0))}
        {assets !== liabilities + otherEquity + (Number(capital && vals[capital.id]) || 0) && <span className="neg">（不一致：元入金の「自動」で調整できます）</span>}
      </p>
      <ErrorBox error={error} />
      <div className="row end">
        <button
          className="primary"
          onClick={async () => {
            try {
              await api.put(`/opening/${year}`, Object.entries(vals).filter(([, v]) => v !== "").map(([k, v]) => ({ account_id: Number(k), amount: v })));
              toast("期首残高を保存しました");
              reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

function DataTab() {
  const { year } = useApp();
  const sys = useFetch<{ ai: boolean; r2: boolean; encryption: boolean; gmo_oauth: boolean }>("/system-check");
  const log = useFetch<Array<{ id: number; at: string; action: string; entity: string; entity_id: number }>>("/audit-log?limit=50");
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>エクスポート・バックアップ</h3>
        <div className="row">
          <a className="btn" href={`/api/export/journals.csv?year=${year}`}>{year}年の仕訳帳（CSV）</a>
          <a className="btn" href="/api/export/backup.json">全データのバックアップ（JSON）</a>
        </div>
        <p className="muted small">毎日 6:00（JST）に R2 の backups/ フォルダへ自動バックアップされます。</p>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Cloudflare 連携の状態</h3>
        {sys.data && (
          <ul>
            <li>R2（領収書ドライブ）: {sys.data.r2 ? "✅" : "❌"}</li>
            <li>Workers AI（自動仕訳の補助）: {sys.data.ai ? "✅" : "❌ 未設定（ルール・辞書のみで動作）"}</li>
            <li>暗号化キー（銀行APIトークン用）: {sys.data.encryption ? "✅" : "❌ ENCRYPTION_KEY を設定してください"}</li>
            <li>GMOあおぞらネット銀行 OAuth: {sys.data.gmo_oauth ? "✅" : "未設定（sunabar のトークン直接登録は利用可）"}</li>
          </ul>
        )}
        <p className="small">
          <b>メールで領収書を受け取る:</b> Cloudflare Email Routing で任意のアドレス（例: receipts@あなたのドメイン）をこの Worker に転送すると、添付の PDF・画像が自動で領収書として保存されます。
        </p>
      </div>
      <div className="card table-wrap">
        <h3 style={{ marginTop: 0 }}>訂正・削除履歴（直近50件）</h3>
        <table className="small">
          <thead><tr><th>日時(UTC)</th><th>操作</th><th>対象</th></tr></thead>
          <tbody>
            {log.data?.map((l) => (
              <tr key={l.id}>
                <td>{l.at}</td>
                <td>{l.action === "create" ? "作成" : l.action === "update" ? "訂正" : "削除"}</td>
                <td>{l.entity === "journal" ? <a href={`#/journals?id=${l.entity_id}`}>仕訳 #{l.entity_id}</a> : `書類 #${l.entity_id}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
