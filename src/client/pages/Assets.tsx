import { useState } from "react";
import { api } from "../api";
import { useApp, useFetch } from "../app";
import { AccountSelect, AmountInput, ErrorBox, Field, Modal, useAccountName } from "../components";
import { today, yen } from "../format";

interface Asset {
  id: number;
  name: string;
  account_id: number;
  quantity: number;
  acquisition_date: string;
  service_date: string | null;
  acquisition_cost: number;
  useful_life: number;
  method: "straight_line" | "lump_sum" | "immediate";
  business_ratio: number;
  disposal_date: string | null;
  memo: string | null;
  schedule: { months: number; opening_book: number; depreciation: number; business_amount: number; closing_book: number; rate: number };
}

const METHOD = { straight_line: "定額法", lump_sum: "一括償却（3年）", immediate: "少額減価償却資産の特例（即時）" };
const LIFE_HINTS = [
  ["パソコン", 4], ["サーバー", 5], ["スマートフォン・携帯電話", 10], ["プリンター・複合機", 5], ["カメラ", 5],
  ["机・椅子（金属）", 15], ["机・椅子（その他）", 8], ["普通自動車（新車）", 6], ["軽自動車（新車）", 4], ["ソフトウェア", 5], ["建物附属設備（内装）", 15],
] as const;

export function AssetsPage() {
  const { year } = useApp();
  const name = useAccountName();
  const list = useFetch<Asset[]>(`/assets?year=${year}`, [year]);
  const [editing, setEditing] = useState<Partial<Asset> | null>(null);
  const total = (list.data ?? []).reduce((s, a) => ({ dep: s.dep + a.schedule.depreciation, biz: s.biz + a.schedule.business_amount }), { dep: 0, biz: 0 });

  return (
    <>
      <div className="row between">
        <h1>固定資産台帳</h1>
        <button className="primary" onClick={() => setEditing({ acquisition_date: today(), method: "straight_line", useful_life: 4, business_ratio: 100, quantity: 1 })}>
          ＋ 資産を登録
        </button>
      </div>
      <p className="muted">
        10万円以上のパソコン・車などは購入時に資産として記帳し（例: 工具器具備品 / 普通預金）、毎年の減価償却費を<a href="#/closing">決算整理</a>で計上します。青色申告者は30万円未満なら「少額減価償却資産の特例」で一括経費にできます（年300万円まで）。
      </p>
      <ErrorBox error={list.error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>資産名</th>
              <th>科目</th>
              <th>取得日</th>
              <th className="num">取得価額</th>
              <th>償却方法</th>
              <th className="num">耐用年数</th>
              <th className="num">期首残高</th>
              <th className="num">{year}年 償却費</th>
              <th className="num">事業割合</th>
              <th className="num">経費算入額</th>
              <th className="num">期末残高</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setEditing(a)}>
                <td>{a.name}{a.disposal_date && <span className="tag" style={{ marginLeft: 4 }}>除却 {a.disposal_date}</span>}</td>
                <td>{name(a.account_id)}</td>
                <td>{a.service_date || a.acquisition_date}</td>
                <td className="num">{yen(a.acquisition_cost)}</td>
                <td>{METHOD[a.method]}</td>
                <td className="num">{a.method === "straight_line" ? `${a.useful_life}年` : "-"}</td>
                <td className="num">{yen(a.schedule.opening_book)}</td>
                <td className="num">{yen(a.schedule.depreciation)}{a.schedule.months > 0 && a.schedule.months < 12 && a.method === "straight_line" && <span className="muted small"> ({a.schedule.months}月)</span>}</td>
                <td className="num">{a.business_ratio}%</td>
                <td className="num">{yen(a.schedule.business_amount)}</td>
                <td className="num">{yen(a.schedule.closing_book)}</td>
              </tr>
            ))}
            {list.data && list.data.length > 0 && (
              <tr className="total">
                <td colSpan={7}>合計</td>
                <td className="num">{yen(total.dep)}</td>
                <td />
                <td className="num">{yen(total.biz)}</td>
                <td />
              </tr>
            )}
            {list.data?.length === 0 && <tr><td colSpan={11} className="muted">登録された資産はありません</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <AssetModal a={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), list.reload())} />}
    </>
  );
}

function AssetModal({ a, onClose, onSaved }: { a: Partial<Asset>; onClose: () => void; onSaved: () => void }) {
  const { accounts } = useApp();
  const [f, setF] = useState<Partial<Asset>>({ account_id: accounts.find((x) => x.name === "工具器具備品")?.id, ...a });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Asset>) => setF({ ...f, ...p });
  const save = async () => {
    try {
      if (a.id) await api.put(`/assets/${a.id}`, f);
      else await api.post("/assets", f);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={a.id ? "資産の編集" : "資産の登録"}
      onClose={onClose}
      footer={
        <>
          {a.id && <button className="danger" onClick={() => confirm("削除しますか？") && api.del(`/assets/${a.id}`).then(onSaved)}>削除</button>}
          <span className="spacer" />
          <button className="primary" onClick={save}>保存</button>
        </>
      }
    >
      <div className="grid grid-2">
        <Field label="資産名"><input type="text" value={f.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="勘定科目">
          <AccountSelect value={f.account_id ?? ""} onChange={(id) => set({ account_id: id })} categories={["asset"]} />
        </Field>
        <Field label="取得日"><input type="date" value={f.acquisition_date ?? ""} onChange={(e) => set({ acquisition_date: e.target.value })} /></Field>
        <Field label="事業供用日（取得日と異なる場合）"><input type="date" value={f.service_date ?? ""} onChange={(e) => set({ service_date: e.target.value || null })} /></Field>
        <Field label="取得価額（税込）"><AmountInput value={f.acquisition_cost ?? ""} onChange={(v) => set({ acquisition_cost: v === "" ? undefined : v })} /></Field>
        <Field label="数量"><input type="number" value={f.quantity ?? 1} onChange={(e) => set({ quantity: Number(e.target.value) })} /></Field>
        <Field label="償却方法">
          <select value={f.method} onChange={(e) => set({ method: e.target.value as Asset["method"] })}>
            {Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {f.method === "straight_line" && (
          <Field label="耐用年数">
            <div className="row">
              <input type="number" value={f.useful_life ?? 4} onChange={(e) => set({ useful_life: Number(e.target.value) })} style={{ width: 80 }} />
              <select value="" onChange={(e) => e.target.value && set({ useful_life: Number(e.target.value) })}>
                <option value="">目安から選ぶ</option>
                {LIFE_HINTS.map(([n, y]) => <option key={n} value={y}>{n}: {y}年</option>)}
              </select>
            </div>
          </Field>
        )}
        <Field label="事業専用割合（%）"><input type="number" min={0} max={100} value={f.business_ratio ?? 100} onChange={(e) => set({ business_ratio: Number(e.target.value) })} /></Field>
        <Field label="除却・売却日"><input type="date" value={f.disposal_date ?? ""} onChange={(e) => set({ disposal_date: e.target.value || null })} /></Field>
        <Field label="メモ" style={{ gridColumn: "1 / -1" }}><input type="text" value={f.memo ?? ""} onChange={(e) => set({ memo: e.target.value })} /></Field>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
