import { useEffect, useState } from "react";
import { qs } from "../api";
import { useApp, useFetch } from "../app";
import { AccountSelect, ErrorBox } from "../components";
import { CATEGORY_LABELS, yen } from "../format";
import type { Account, Category } from "../types";

interface TBRow { account_id: number; code: string; name: string; category: Category; opening: number; debit: number; credit: number; closing: number }
interface Ledger {
  account: Account;
  opening: number;
  closing: number;
  rows: Array<{ journal_id: number; date: string; description: string; partner: string | null; counter: string; debit: number; credit: number; balance: number }>;
}

export function ReportsPage() {
  const { year, accounts } = useApp();
  const [tab, setTab] = useState<"tb" | "ledger" | "monthly">("tb");
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [accountId, setAccountId] = useState<number | "">(accounts.find((a) => a.name === "普通預金")?.id ?? "");
  useEffect(() => {
    setFrom(`${year}-01-01`);
    setTo(`${year}-12-31`);
  }, [year]);

  return (
    <>
      <h1>帳簿・レポート</h1>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <div className="seg">
          <button className={tab === "tb" ? "on" : ""} onClick={() => setTab("tb")}>残高試算表</button>
          <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>総勘定元帳</button>
          <button className={tab === "monthly" ? "on" : ""} onClick={() => setTab("monthly")}>月次推移</button>
        </div>
        {tab !== "monthly" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />〜
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        {tab === "ledger" && <AccountSelect value={accountId} onChange={setAccountId} includeInactive />}
        <span className="spacer" />
        <button onClick={() => window.print()}>印刷 / PDF保存</button>
      </div>
      {tab === "tb" && <TrialBalance from={from} to={to} />}
      {tab === "ledger" && accountId !== "" && <LedgerView accountId={accountId} from={from} to={to} />}
      {tab === "monthly" && <Monthly year={year} />}
    </>
  );
}

function TrialBalance({ from, to }: { from: string; to: string }) {
  const { data, error } = useFetch<TBRow[]>(`/reports/trial-balance${qs({ from, to })}`);
  const cats: Category[] = ["asset", "liability", "equity", "revenue", "expense"];
  return (
    <div className="card table-wrap">
      <ErrorBox error={error} />
      <h3 style={{ marginTop: 0 }}>残高試算表（{from} 〜 {to}）</h3>
      <table>
        <thead>
          <tr><th>科目</th><th className="num">期首残高</th><th className="num">借方</th><th className="num">貸方</th><th className="num">期末残高</th></tr>
        </thead>
        <tbody>
          {cats.map((c) => {
            const rows = data?.filter((r) => r.category === c) ?? [];
            if (!rows.length) return null;
            const sum = rows.reduce((s, r) => ({ o: s.o + r.opening, d: s.d + r.debit, c: s.c + r.credit, e: s.e + r.closing }), { o: 0, d: 0, c: 0, e: 0 });
            return [
              ...rows.map((r) => (
                <tr key={r.account_id}>
                  <td>{r.code} {r.name}</td>
                  <td className="num">{yen(r.opening)}</td>
                  <td className="num">{yen(r.debit)}</td>
                  <td className="num">{yen(r.credit)}</td>
                  <td className={`num ${r.closing < 0 ? "neg" : ""}`}>{yen(r.closing)}</td>
                </tr>
              )),
              <tr key={`${c}-sum`} className="total">
                <td>{CATEGORY_LABELS[c]} 計</td>
                <td className="num">{yen(sum.o)}</td>
                <td className="num">{yen(sum.d)}</td>
                <td className="num">{yen(sum.c)}</td>
                <td className="num">{yen(sum.e)}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function LedgerView({ accountId, from, to }: { accountId: number; from: string; to: string }) {
  const { data, error } = useFetch<Ledger>(`/reports/ledger${qs({ account_id: accountId, from, to })}`);
  return (
    <div className="card table-wrap">
      <ErrorBox error={error} />
      {data && (
        <>
          <h3 style={{ marginTop: 0 }}>総勘定元帳: {data.account.name}（{from} 〜 {to}）</h3>
          <table>
            <thead>
              <tr><th>日付</th><th>相手科目</th><th>摘要</th><th className="num">借方</th><th className="num">貸方</th><th className="num">残高</th></tr>
            </thead>
            <tbody>
              <tr><td /><td colSpan={4} className="muted">前期繰越</td><td className="num">{yen(data.opening)}</td></tr>
              {data.rows.map((r, i) => (
                <tr key={i} className="clickable" onClick={() => (window.location.hash = `/journals?id=${r.journal_id}`)}>
                  <td>{r.date}</td>
                  <td>{r.counter}</td>
                  <td>{r.description}{r.partner && <span className="muted small"> / {r.partner}</span>}</td>
                  <td className="num">{r.debit ? yen(r.debit) : ""}</td>
                  <td className="num">{r.credit ? yen(r.credit) : ""}</td>
                  <td className={`num ${r.balance < 0 ? "neg" : ""}`}>{yen(r.balance)}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={5}>期末残高</td><td className="num">{yen(data.closing)}</td></tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Monthly({ year }: { year: number }) {
  const { data, error } = useFetch<Array<{ month: number; sales: number; misc_income: number; purchases: number; revenue: number; expense: number; profit: number }>>(`/reports/monthly?year=${year}`, [year]);
  const sum = (k: "sales" | "revenue" | "expense" | "profit" | "purchases") => (data ?? []).reduce((s, m) => s + m[k], 0);
  return (
    <div className="card table-wrap">
      <ErrorBox error={error} />
      <h3 style={{ marginTop: 0 }}>{year}年 月次推移</h3>
      <table>
        <thead>
          <tr><th>月</th><th className="num">売上</th><th className="num">収益計</th><th className="num">仕入</th><th className="num">費用計</th><th className="num">損益</th></tr>
        </thead>
        <tbody>
          {data?.map((m) => (
            <tr key={m.month}>
              <td>{m.month}月</td>
              <td className="num">{yen(m.sales)}</td>
              <td className="num">{yen(m.revenue)}</td>
              <td className="num">{yen(m.purchases)}</td>
              <td className="num">{yen(m.expense)}</td>
              <td className={`num ${m.profit < 0 ? "neg" : ""}`}>{yen(m.profit)}</td>
            </tr>
          ))}
          <tr className="total">
            <td>合計</td>
            <td className="num">{yen(sum("sales"))}</td>
            <td className="num">{yen(sum("revenue"))}</td>
            <td className="num">{yen(sum("purchases"))}</td>
            <td className="num">{yen(sum("expense"))}</td>
            <td className="num">{yen(sum("profit"))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
