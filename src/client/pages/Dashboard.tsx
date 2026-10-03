import { useApp, useFetch } from "../app";
import { ErrorBox } from "../components";
import { yen } from "../format";

interface Dashboard {
  sales: number;
  expenses: number;
  income_before_deduction: number;
  income: number;
  months: Array<{ month: number; revenue: number; expense: number; profit: number }>;
  cash: Array<{ name: string; balance: number }>;
  top_expenses: Array<{ name: string; amount: number }>;
  unprocessed_bank: number;
  unlinked_receipts: number;
  journal_count: number;
}

export function DashboardPage() {
  const { year, settings } = useApp();
  const { data, error } = useFetch<Dashboard>(`/reports/dashboard?year=${year}`, [year]);
  const tax = useFetch<{ result: { payable: number; total_tax: number } }>(`/tax/${year}/income`, [year]);
  const max = Math.max(1, ...(data?.months ?? []).flatMap((m) => [m.revenue, m.expense]));

  return (
    <>
      <h1>{year}年のようす</h1>
      <ErrorBox error={error} />
      {!settings.owner_name && (
        <div className="alert info">
          はじめに <a href="#/settings">事業者設定</a> で氏名・屋号・申告区分（青色/白色）を登録してください。期首残高もここで設定できます。
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-4">
            <div className="card stat">
              <div className="label">売上（収入）</div>
              <div className="value">¥{yen(data.sales)}</div>
            </div>
            <div className="card stat">
              <div className="label">経費（売上原価含む）</div>
              <div className="value">¥{yen(data.expenses)}</div>
            </div>
            <div className="card stat">
              <div className="label">所得（{settings.filing_type === "blue" ? "青色控除後" : "所得金額"}）</div>
              <div className={`value ${data.income < 0 ? "neg" : ""}`}>¥{yen(data.income)}</div>
            </div>
            <div className="card stat">
              <div className="label">所得税の見込み（{tax.data && tax.data.result.payable < 0 ? "還付" : "納付"}）</div>
              <div className={`value ${tax.data && tax.data.result.payable < 0 ? "pos" : ""}`}>{tax.data ? `¥${yen(Math.abs(tax.data.result.payable))}` : "-"}</div>
              <div className="muted small">
                <a href="#/tax">所得控除を入力して精度を上げる</a>
              </div>
            </div>
          </div>

          {(data.unprocessed_bank > 0 || data.unlinked_receipts > 0) && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>やることリスト</h3>
              <ul style={{ margin: 0 }}>
                {data.unprocessed_bank > 0 && (
                  <li>
                    未処理の明細が <b>{data.unprocessed_bank}件</b> あります → <a href="#/bank">明細を仕訳する</a>
                  </li>
                )}
                {data.unlinked_receipts > 0 && (
                  <li>
                    仕訳に未紐付けの領収書が <b>{data.unlinked_receipts}件</b> あります → <a href="#/receipts?unlinked=1">紐付ける</a>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="grid grid-2">
            <div className="card">
              <div className="row between">
                <h3 style={{ margin: 0 }}>月別の収入・支出</h3>
                <div className="legend">
                  <span><i style={{ background: "var(--primary)" }} />収入</span>
                  <span><i style={{ background: "#d59a4a" }} />支出</span>
                </div>
              </div>
              <div className="bars">
                {data.months.map((m) => (
                  <div className="bar-col" key={m.month} title={`${m.month}月 収入 ${yen(m.revenue)} / 支出 ${yen(m.expense)}`}>
                    <div className="bar-pair">
                      <div className="bar in" style={{ height: `${(Math.max(0, m.revenue) / max) * 100}%` }} />
                      <div className="bar out" style={{ height: `${(Math.max(0, m.expense) / max) * 100}%` }} />
                    </div>
                    <span className="muted small">{m.month}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>経費の内訳（上位）</h3>
              {data.top_expenses.length === 0 && <p className="muted">まだ経費がありません。</p>}
              <table>
                <tbody>
                  {data.top_expenses.map((e) => (
                    <tr key={e.name}>
                      <td>{e.name}</td>
                      <td className="num">{yen(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>預金・現金残高（帳簿）</h3>
            <div className="row" style={{ gap: 24 }}>
              {data.cash.map((c) => (
                <div key={c.name} className="stat">
                  <div className="label">{c.name}</div>
                  <div className={`value ${c.balance < 0 ? "neg" : ""}`} style={{ fontSize: 18 }}>¥{yen(c.balance)}</div>
                </div>
              ))}
            </div>
            <p className="muted small">仕訳数: {data.journal_count}件</p>
          </div>
        </>
      )}
    </>
  );
}
