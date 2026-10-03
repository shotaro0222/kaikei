import { useState } from "react";
import { api } from "../api";
import { useApp, useFetch } from "../app";
import { AccountSelect, Confidence, ErrorBox, Field, useAccountName } from "../components";
import { TAX_LABELS } from "../format";
import type { Suggestion, TaxCategory } from "../types";

interface Rule {
  id: number;
  keyword: string;
  match_type: string;
  direction: string;
  account_id: number;
  tax_category: TaxCategory | null;
  partner: string | null;
  priority: number;
  kind: string;
  hits: number;
}

const MATCH = { contains: "を含む", exact: "と一致", prefix: "で始まる", regex: "正規表現" };
const DIR = { any: "収支とも", expense: "支出", income: "収入" };

export function RulesPage() {
  const { toast } = useApp();
  const name = useAccountName();
  const rules = useFetch<Rule[]>("/rules");
  const empty = { keyword: "", match_type: "contains", direction: "expense", account_id: 0, tax_category: null as TaxCategory | null, partner: "", priority: 0 };
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testText, setTestText] = useState("");
  const [testDir, setTestDir] = useState<"expense" | "income">("expense");
  const [test, setTest] = useState<Suggestion | null>(null);

  const save = async () => {
    setError(null);
    try {
      if (editId) await api.put(`/rules/${editId}`, form);
      else await api.post("/rules", form);
      toast("ルールを保存しました");
      setForm(empty);
      setEditId(null);
      rules.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <h1>自動仕訳ルール</h1>
      <p className="muted">
        摘要・利用用途に含まれるキーワードから勘定科目を決めるルールです。推定の優先順位は「学習（過去の仕訳）→ 登録ルール → 組込み辞書（約300語）→ AI（Workers AI）」です。
      </p>
      <div className="grid grid-2">
        <div className="card stack">
          <h3 style={{ margin: 0 }}>{editId ? "ルールを編集" : "ルールを追加"}</h3>
          <div className="row">
            <Field label="キーワード" style={{ flex: 1 }}>
              <input type="text" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="例: ｺｳｻﾞﾌﾘｶｴ ﾃﾞﾝｷ" />
            </Field>
            <Field label="一致条件">
              <select value={form.match_type} onChange={(e) => setForm({ ...form, match_type: e.target.value })}>
                {Object.entries(MATCH).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="対象">
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                {Object.entries(DIR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="勘定科目" style={{ flex: 1 }}>
              <AccountSelect value={form.account_id || ""} onChange={(id) => setForm({ ...form, account_id: id })} />
            </Field>
            <Field label="税区分（空欄なら科目の既定）">
              <select value={form.tax_category ?? ""} onChange={(e) => setForm({ ...form, tax_category: (e.target.value || null) as TaxCategory | null })}>
                <option value="">科目の既定</option>
                {Object.entries(TAX_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="取引先（自動入力・任意）" style={{ flex: 1 }}>
              <input type="text" value={form.partner ?? ""} onChange={(e) => setForm({ ...form, partner: e.target.value })} />
            </Field>
            <Field label="優先度">
              <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} style={{ width: 80 }} />
            </Field>
          </div>
          <ErrorBox error={error} />
          <div className="row end">
            {editId && <button onClick={() => (setEditId(null), setForm(empty))}>キャンセル</button>}
            <button className="primary" onClick={save} disabled={!form.keyword || !form.account_id}>
              保存
            </button>
          </div>
        </div>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>推定のテスト</h3>
          <div className="row">
            <select value={testDir} onChange={(e) => setTestDir(e.target.value as "expense" | "income")}>
              <option value="expense">支出</option>
              <option value="income">収入</option>
            </select>
            <input type="text" value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="例: ﾐﾂｲｽﾐﾄﾓｶ-ﾄﾞ" style={{ flex: 1 }} />
            <button onClick={() => api.post<Suggestion>("/rules/test", { text: testText, direction: testDir }).then(setTest)}>試す</button>
          </div>
          {test && (
            <p>
              → <b>{name(test.account_id)}</b>（{TAX_LABELS[test.tax_category]}） <Confidence v={test.confidence} source={test.source} /> <span className="muted small">{test.reason}</span>
            </p>
          )}
        </div>
      </div>
      <ErrorBox error={rules.error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>種類</th>
              <th>条件</th>
              <th>対象</th>
              <th>勘定科目</th>
              <th>税区分</th>
              <th className="num">適用回数</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.data?.map((r) => (
              <tr key={r.id}>
                <td><span className={`tag ${r.kind === "learned" ? "ok" : ""}`}>{r.kind === "learned" ? "学習" : "登録"}</span></td>
                <td>「{r.keyword}」{MATCH[r.match_type as keyof typeof MATCH]}</td>
                <td>{DIR[r.direction as keyof typeof DIR]}</td>
                <td>{name(r.account_id)}</td>
                <td>{r.tax_category ? TAX_LABELS[r.tax_category] : <span className="muted">既定</span>}</td>
                <td className="num">{r.hits}</td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="link" onClick={() => (setEditId(r.id), setForm({ keyword: r.keyword, match_type: r.match_type, direction: r.direction, account_id: r.account_id, tax_category: r.tax_category, partner: r.partner ?? "", priority: r.priority }))}>
                    編集
                  </button>
                  <button className="link" onClick={() => confirm("削除しますか？") && api.del(`/rules/${r.id}`).then(rules.reload)}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {rules.data?.length === 0 && (
              <tr><td colSpan={7} className="muted">ルールはまだありません。仕訳を登録すると自動で学習されます。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
