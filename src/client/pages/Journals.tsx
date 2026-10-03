import { useEffect, useState } from "react";
import { api, qs } from "../api";
import { useApp, useFetch, useRoute } from "../app";
import { AccountSelect, AmountInput, ErrorBox, Field, Modal, TaxSelect, useAccountName } from "../components";
import { SOURCE_LABELS, TAX_LABELS, today, yen } from "../format";
import type { Journal, Line } from "../types";

type EditLine = Omit<Line, "amount"> & { amount: number | "" };
import { pairRows } from "./QuickEntry";

export function JournalsPage() {
  const { year, refreshCounts } = useApp();
  const { params } = useRoute();
  const name = useAccountName();
  const [q, setQ] = useState("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Journal | "new" | null>(null);
  useEffect(() => {
    setFrom(`${year}-01-01`);
    setTo(`${year}-12-31`);
  }, [year]);
  useEffect(() => {
    const id = Number(params.get("id"));
    if (id) api.get<Journal>(`/journals/${id}`).then(setEditing).catch(() => {});
  }, [params]);
  const limit = 100;
  const { data, error, reload } = useFetch<{ items: Journal[]; total: number }>(
    `/journals${qs({ q, account_id: accountId, from, to, limit, offset: page * limit })}`,
    [],
  );

  return (
    <>
      <div className="row between">
        <h1>仕訳帳</h1>
        <div className="row">
          <a className="btn" href={`/api/export/journals.csv?year=${year}`}>
            CSV出力
          </a>
          <button className="primary" onClick={() => setEditing("new")}>
            ＋ 振替伝票で入力
          </button>
        </div>
      </div>
      <div className="card row">
        <input type="search" placeholder="摘要・取引先・メモで検索" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} style={{ flex: 1, minWidth: 180 }} />
        <AccountSelect value={accountId} onChange={(id) => (setAccountId(id), setPage(0))} placeholder="すべての科目" includeInactive />
        {accountId !== "" && <button className="link" onClick={() => setAccountId("")}>科目解除</button>}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />〜
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>借方</th>
              <th className="num">金額</th>
              <th>貸方</th>
              <th className="num">金額</th>
              <th>摘要</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((j) =>
              pairRows(j.lines).map((r, i) => (
                <tr key={`${j.id}-${i}`} className="clickable" onClick={() => setEditing(j)}>
                  <td>{i === 0 ? j.date : ""}</td>
                  <td>{r.d ? name(r.d.account_id) : ""}</td>
                  <td className="num">{r.d ? yen(r.d.amount) : ""}</td>
                  <td>{r.c ? name(r.c.account_id) : ""}</td>
                  <td className="num">{r.c ? yen(r.c.amount) : ""}</td>
                  <td>
                    {i === 0 && (
                      <>
                        {j.description}
                        {j.partner && <span className="muted small"> / {j.partner}</span>}
                      </>
                    )}
                  </td>
                  <td>
                    {i === 0 && (
                      <span className="row" style={{ gap: 4 }}>
                        {j.source !== "manual" && <span className="tag">{SOURCE_LABELS[j.source] ?? j.source}</span>}
                        {(j.receipts?.length ?? 0) > 0 && <span className="tag ok" title="領収書あり">📎{j.receipts!.length}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              )),
            )}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  仕訳がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.total > limit && (
        <div className="row end">
          <span className="muted">
            {page * limit + 1}〜{Math.min((page + 1) * limit, data.total)} / {data.total}件
          </span>
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>前へ</button>
          <button disabled={(page + 1) * limit >= data.total} onClick={() => setPage(page + 1)}>次へ</button>
        </div>
      )}
      {editing && (
        <JournalEditor
          journal={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            if (params.get("id")) window.location.hash = "/journals";
          }}
          onSaved={() => {
            setEditing(null);
            reload();
            refreshCounts();
          }}
        />
      )}
    </>
  );
}

export function JournalEditor({ journal, onClose, onSaved }: { journal: Journal | null; onClose: () => void; onSaved: () => void }) {
  const { accounts, toast } = useApp();
  const [date, setDate] = useState(journal?.date ?? today());
  const [description, setDescription] = useState(journal?.description ?? "");
  const [partner, setPartner] = useState(journal?.partner ?? "");
  const [memo, setMemo] = useState(journal?.memo ?? "");
  const [lines, setLines] = useState<EditLine[]>(
    journal?.lines.map((l) => ({ ...l })) ?? [
      { side: "debit", account_id: 0, amount: "", tax_category: "out" },
      { side: "credit", account_id: 0, amount: "", tax_category: "out" },
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: number; at: string; action: string }> | null>(null);
  const dr = lines.filter((l) => l.side === "debit").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const cr = lines.filter((l) => l.side === "credit").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const generated = journal && ["depreciation", "apportion", "inventory"].includes(journal.source);

  const update = (i: number, patch: Partial<EditLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    const body = { date, description, partner: partner || null, memo: memo || null, lines: lines.filter((l) => l.account_id && l.amount).map((l) => ({ ...l, amount: Number(l.amount) })) };
    try {
      if (journal) await api.put(`/journals/${journal.id}`, body);
      else await api.post("/journals", body);
      toast("保存しました");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!journal || !confirm("この仕訳を削除しますか？（削除履歴は保存されます）")) return;
    try {
      await api.del(`/journals/${journal.id}`);
      toast("削除しました");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={journal ? `仕訳の編集 #${journal.id}` : "振替伝票"}
      onClose={onClose}
      footer={
        <>
          {journal && (
            <button className="danger" onClick={remove}>
              削除
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" onClick={save} disabled={dr !== cr || dr === 0}>
            保存
          </button>
        </>
      }
    >
      {generated && <div className="alert warn small">決算整理で自動作成された仕訳です。決算整理画面で再作成すると上書きされます。</div>}
      <div className="row">
        <Field label="日付">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="摘要" style={{ flex: 2 }}>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="取引先" style={{ flex: 1 }}>
          <input type="text" value={partner} onChange={(e) => setPartner(e.target.value)} />
        </Field>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>借/貸</th>
              <th>勘定科目</th>
              <th className="num">金額</th>
              <th>税区分</th>
              <th>行メモ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select value={l.side} onChange={(e) => update(i, { side: e.target.value as Line["side"] })}>
                    <option value="debit">借方</option>
                    <option value="credit">貸方</option>
                  </select>
                </td>
                <td>
                  <AccountSelect
                    value={l.account_id || ""}
                    onChange={(id) => {
                      const a = accounts.find((x) => x.id === id);
                      update(i, { account_id: id, tax_category: a?.tax_default ?? "out" });
                    }}
                  />
                </td>
                <td>
                  <AmountInput value={l.amount} onChange={(v) => update(i, { amount: v })} />
                </td>
                <td>
                  <TaxSelect value={l.tax_category} onChange={(t) => update(i, { tax_category: t })} />
                </td>
                <td>
                  <input type="text" value={l.memo ?? ""} onChange={(e) => update(i, { memo: e.target.value })} />
                </td>
                <td>
                  {lines.length > 2 && (
                    <button className="link" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="total">
              <td colSpan={2}>
                借方 {yen(dr)} / 貸方 {yen(cr)}
                {dr !== cr && <span className="neg"> （差額 {yen(dr - cr)}）</span>}
              </td>
              <td colSpan={4}>
                <button className="link" onClick={() => setLines([...lines, { side: dr > cr ? "credit" : "debit", account_id: 0, amount: Math.abs(dr - cr) || "", tax_category: "out" } as EditLine])}>
                  ＋ 行を追加
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Field label="メモ" style={{ marginTop: 10 }}>
        <textarea value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      {journal?.receipts && journal.receipts.length > 0 && (
        <p className="small">
          添付書類:{" "}
          {journal.receipts.map((r) => (
            <a key={r.id} href={`/api/receipts/${r.id}/file`} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
              📎{r.file_name}
            </a>
          ))}
        </p>
      )}
      {journal && (
        <p className="small">
          <button className="link" onClick={() => api.get<Array<{ id: number; at: string; action: string }>>(`/audit-log?entity=journal&entity_id=${journal.id}`).then(setHistory)}>
            訂正・削除履歴を表示
          </button>
          {history && (
            <span className="muted">
              {history.map((h) => `${h.at}(UTC) ${h.action === "create" ? "作成" : h.action === "update" ? "訂正" : "削除"}`).join(" / ")}
            </span>
          )}
        </p>
      )}
      <p className="muted small">税区分: {Object.values(TAX_LABELS).join("・")}。税込経理で記帳します。</p>
      <ErrorBox error={error} />
    </Modal>
  );
}
