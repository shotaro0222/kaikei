import { useState } from "react";
import { api } from "../api";
import { useApp, useFetch } from "../app";
import { AmountInput, ErrorBox } from "../components";
import { yen } from "../format";

interface ClosingStatus {
  depreciation: Array<{ asset: { id: number; name: string; business_ratio: number }; result: { depreciation: number; business_amount: number } }>;
  apportion: Array<{ account_id: number; account_name: string; total: number; business: number; private: number; ratio: number }>;
  generated: Array<{ source: string; n: number; at: string }>;
  closing_inventory: number | null;
  next_year_opening: boolean;
}

export function ClosingPage() {
  const { year, toast, setYear } = useApp();
  const st = useFetch<ClosingStatus>(`/closing/${year}`, [year]);
  const [inv, setInv] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gen = (s: string) => st.data?.generated.find((g) => g.source === s);

  const run = async (path: string, body: unknown, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/closing/${year}/${path}`, body);
      toast(msg);
      st.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const d = st.data;
  return (
    <>
      <h1>{year}年 決算整理</h1>
      <p className="muted">12月31日時点の決算整理仕訳を作成します。上から順に実行してください。何度実行しても前回分を置き換えるので安全です。</p>
      <ErrorBox error={error || st.error} />
      {d && (
        <>
          <div className="card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>① 減価償却費の計上</h3>
              {gen("depreciation") ? <span className="tag ok">作成済み {gen("depreciation")!.n}件</span> : <span className="tag warn">未作成</span>}
            </div>
            {d.depreciation.length === 0 ? (
              <p className="muted">本年に償却する資産はありません。</p>
            ) : (
              <table>
                <tbody>
                  {d.depreciation.map((x) => (
                    <tr key={x.asset.id}>
                      <td>{x.asset.name}</td>
                      <td className="num">償却費 {yen(x.result.depreciation)}</td>
                      <td className="num">経費算入 {yen(x.result.business_amount)}（{x.asset.business_ratio}%）</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row end">
              <button className="primary" disabled={busy || d.depreciation.length === 0} onClick={() => run("depreciation", {}, "減価償却仕訳を作成しました")}>
                減価償却仕訳を作成
              </button>
            </div>
          </div>

          <div className="card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>② 家事按分（決算時按分の科目）</h3>
              {gen("apportion") ? <span className="tag ok">作成済み {gen("apportion")!.n}件</span> : <span className="tag warn">未作成</span>}
            </div>
            {d.apportion.length === 0 ? (
              <p className="muted">決算時に按分する科目はありません（<a href="#/apportion">家事按分の設定</a>）。</p>
            ) : (
              <table>
                <thead>
                  <tr><th>科目</th><th className="num">年間計上額</th><th className="num">事業割合</th><th className="num">事業分（経費）</th><th className="num">私用分（事業主貸へ）</th></tr>
                </thead>
                <tbody>
                  {d.apportion.map((x) => (
                    <tr key={x.account_id}>
                      <td>{x.account_name}</td>
                      <td className="num">{yen(x.total)}</td>
                      <td className="num">{x.ratio}%</td>
                      <td className="num">{yen(x.business)}</td>
                      <td className="num">{yen(x.private)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row end">
              <button className="primary" disabled={busy || (d.apportion.length === 0 && !gen("apportion"))} onClick={() => run("apportion", {}, "家事按分の振替仕訳を作成しました")}>
                家事按分仕訳を作成
              </button>
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: 0 }}>③ 期末商品棚卸高（物販・飲食業など在庫がある場合）</h3>
            <p className="muted small">12月31日時点で売れ残っている商品・材料の仕入金額の合計を入力します。在庫がなければ不要です。</p>
            <div className="row">
              <span>現在の登録額: {d.closing_inventory != null ? `¥${yen(d.closing_inventory)}` : "なし"}</span>
              <span className="spacer" />
              <AmountInput value={inv} onChange={setInv} />
              <button className="primary" disabled={busy || inv === ""} onClick={() => run("inventory", { amount: inv }, "期末棚卸高を登録しました")}>
                登録
              </button>
            </div>
          </div>

          <div className="card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>④ 確定申告書類の確認</h3>
            </div>
            <p className="small">決算整理が済んだら <a href="#/tax">確定申告書類</a> で青色申告決算書・収支内訳書・申告書（第一表）の金額を確認します。</p>
          </div>

          <div className="card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>⑤ 翌年（{year + 1}年）への繰越</h3>
              {d.next_year_opening ? <span className="tag ok">繰越済み</span> : <span className="tag warn">未実行</span>}
            </div>
            <p className="muted small">
              資産・負債の残高を翌年の期首残高にし、「元入金 = 期首元入金 + 所得 + 事業主借 − 事業主貸」で元入金を再計算します。仕訳を修正した場合は再度実行してください。
            </p>
            <div className="row end">
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  await run("carry-forward", {}, `${year + 1}年へ繰り越しました`);
                  if (confirm(`${year + 1}年分に切り替えますか？`)) setYear(year + 1);
                }}
              >
                翌年へ繰り越す
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
