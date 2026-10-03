import { useState } from "react";
import { api } from "../api";
import { useApp, useFetch } from "../app";
import { AccountSelect, ErrorBox, Field, useAccountName } from "../components";

interface Rule {
  id: number;
  account_id: number;
  business_ratio: number;
  timing: "entry" | "year_end";
  basis: string | null;
  active: number;
}

const PRESETS = [
  { name: "地代家賃", ratio: 30, basis: "仕事部屋の床面積 / 住居全体の床面積" },
  { name: "水道光熱費", ratio: 30, basis: "使用時間・床面積の割合" },
  { name: "通信費", ratio: 50, basis: "業務での使用時間の割合" },
  { name: "車両費", ratio: 50, basis: "業務での走行距離の割合" },
];

export function ApportionPage() {
  const { toast, year, accounts } = useApp();
  const name = useAccountName();
  const rules = useFetch<Rule[]>("/apportion");
  const [form, setForm] = useState({ account_id: 0, business_ratio: 50, timing: "year_end" as Rule["timing"], basis: "" });
  const [error, setError] = useState<string | null>(null);

  const save = async (f = form) => {
    setError(null);
    try {
      await api.put("/apportion", f);
      toast("家事按分を保存しました");
      rules.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <h1>家事按分</h1>
      <p className="muted">
        自宅兼事務所の家賃・光熱費・スマホ代など、事業と私生活の両方に使う費用は、事業で使った割合だけを経費にします。按分の根拠（床面積・使用時間など）を記録しておくと税務調査でも説明できます。
      </p>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>按分ルールを設定</h3>
        <div className="row">
          <Field label="勘定科目（費用）">
            <AccountSelect value={form.account_id || ""} onChange={(id) => setForm({ ...form, account_id: id })} categories={["expense"]} />
          </Field>
          <Field label="事業割合（%）">
            <input type="number" min={0} max={100} value={form.business_ratio} onChange={(e) => setForm({ ...form, business_ratio: Number(e.target.value) })} style={{ width: 90 }} />
          </Field>
          <Field label="按分のタイミング">
            <select value={form.timing} onChange={(e) => setForm({ ...form, timing: e.target.value as Rule["timing"] })}>
              <option value="year_end">決算時にまとめて按分（おすすめ）</option>
              <option value="entry">入力のたびに按分</option>
            </select>
          </Field>
          <Field label="按分の根拠" style={{ flex: 1 }}>
            <input type="text" value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })} placeholder="例: 仕事部屋 10㎡ / 住居 40㎡ = 25%" />
          </Field>
          <button className="primary" style={{ alignSelf: "flex-end" }} disabled={!form.account_id} onClick={() => save()}>
            保存
          </button>
        </div>
        <div className="row small">
          <span className="muted">よく使う設定:</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className="link"
              onClick={() => setForm((f) => ({ ...f, business_ratio: p.ratio, basis: p.basis, account_id: accounts.find((a) => a.name === p.name)?.id ?? f.account_id }))}
            >
              {p.name} {p.ratio}%
            </button>
          ))}
        </div>
        <ErrorBox error={error} />
      </div>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>勘定科目</th>
              <th className="num">事業割合</th>
              <th>タイミング</th>
              <th>根拠</th>
              <th>状態</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.data?.map((r) => (
              <tr key={r.id}>
                <td>{name(r.account_id)}</td>
                <td className="num">{r.business_ratio}%</td>
                <td>{r.timing === "entry" ? "入力時" : "決算時"}</td>
                <td className="small">{r.basis}</td>
                <td>
                  <label className="row small">
                    <input type="checkbox" checked={!!r.active} onChange={(e) => save({ account_id: r.account_id, business_ratio: r.business_ratio, timing: r.timing, basis: r.basis ?? "", active: e.target.checked } as never)} />
                    有効
                  </label>
                </td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="link" onClick={() => setForm({ account_id: r.account_id, business_ratio: r.business_ratio, timing: r.timing, basis: r.basis ?? "" })}>編集</button>
                  <button className="link" onClick={() => confirm("削除しますか？") && api.del(`/apportion/${r.id}`).then(rules.reload)}>削除</button>
                </td>
              </tr>
            ))}
            {rules.data?.length === 0 && <tr><td colSpan={6} className="muted">按分ルールはまだありません。</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card small">
        <b>しくみ</b>
        <ul>
          <li><b>決算時</b>: 1年分を全額経費で記帳しておき、<a href="#/closing">決算整理</a>で「事業主貸 / 経費」の振替仕訳（私用分）を自動作成します（{year}年分）。</li>
          <li><b>入力時</b>: かんたん入力・明細取込のたびに「経費（事業分）＋ 事業主貸（私用分）/ 支払元」に分けて記帳します。個人のお金で払った場合は事業分のみ記帳します。</li>
          <li>減価償却資産（パソコン・車など）の按分は <a href="#/assets">固定資産台帳</a> の「事業専用割合」で設定します。</li>
        </ul>
      </div>
    </>
  );
}
