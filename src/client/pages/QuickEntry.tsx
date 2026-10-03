import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../app";
import { AccountSelect, AmountInput, Confidence, ErrorBox, Field, RepeatOption, TaxSelect, useAccountName } from "../components";
import { TAX_LABELS, today, yen } from "../format";
import type { Direction, Line, Suggestion, TaxCategory } from "../types";

interface SuggestResponse {
  suggestion: Suggestion;
  counter_account_id: number;
  lines: Line[];
  apportion: { business_ratio: number; basis: string | null } | null;
  error: string | null;
}

const PAY_OPTIONS: Record<Direction, Array<{ label: string; account: string; hint: string }>> = {
  expense: [
    { label: "現金", account: "現金", hint: "事業用の現金" },
    { label: "事業用口座", account: "普通預金", hint: "口座振替・振込・デビット" },
    { label: "クレジットカード", account: "未払金", hint: "引落し時は明細取込で消し込み" },
    { label: "個人のお金", account: "事業主借", hint: "プライベートの財布・口座から立替" },
  ],
  income: [
    { label: "口座に入金", account: "普通預金", hint: "振込で受け取った" },
    { label: "現金で受取", account: "現金", hint: "" },
    { label: "未入金（請求済み）", account: "売掛金", hint: "入金時に売掛金を消し込み" },
    { label: "個人口座に入金", account: "事業主貸", hint: "プライベート口座で受取" },
  ],
};

export function QuickEntryPage() {
  const { accounts, toast, refreshCounts } = useApp();
  const name = useAccountName();
  const [direction, setDirection] = useState<Direction>("expense");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [partner, setPartner] = useState("");
  const [memo, setMemo] = useState("");
  const [pay, setPay] = useState("現金");
  const [manualAccount, setManualAccount] = useState<number | null>(null);
  const [manualTax, setManualTax] = useState<TaxCategory | null>(null);
  const [res, setRes] = useState<SuggestResponse | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [repeat, setRepeat] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const counterId = useMemo(() => accounts.find((a) => a.name === pay)?.id, [accounts, pay]);

  useEffect(() => {
    setPay(PAY_OPTIONS[direction][direction === "expense" ? 0 : 0].account);
    setManualAccount(null);
    setManualTax(null);
  }, [direction]);

  useEffect(() => {
    if (!description.trim() && !manualAccount) {
      setRes(null);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .post<SuggestResponse>("/quick/suggest", {
          description,
          amount: amount || 0,
          direction,
          counter_account_id: counterId,
          account_id: manualAccount ?? undefined,
          tax_category: manualTax ?? undefined,
        })
        .then(setRes)
        .catch((e) => setError(e.message));
    }, 350);
    return () => window.clearTimeout(t);
  }, [description, amount, direction, counterId, manualAccount, manualTax]);

  const reset = () => {
    setAmount("");
    setDescription("");
    setPartner("");
    setMemo("");
    setManualAccount(null);
    setManualTax(null);
    setFiles([]);
    setRepeat(1);
    setRes(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    if (!res || !res.lines.length) return;
    setBusy(true);
    setError(null);
    try {
      let receipt_ids: number[] = [];
      if (files.length) {
        const fd = new FormData();
        files.forEach((f) => fd.append("file", f));
        fd.append("issued_date", date);
        fd.append("amount", String(amount));
        fd.append("partner", partner);
        fd.append("doc_type", direction === "income" ? "invoice" : "receipt");
        receipt_ids = (await api.post<{ ids: number[] }>("/receipts", fd)).ids;
      }
      await api.post("/journals", {
        date,
        description: description.trim(),
        partner: partner.trim() || null,
        memo: memo.trim() || null,
        source: "quick",
        lines: res.lines,
        receipt_ids,
        repeat_months: repeat,
        learn: { text: description, direction, account_id: res.suggestion.account_id, tax_category: res.suggestion.tax_category },
      });
      toast(repeat > 1 ? `${repeat}か月分の仕訳を登録しました` : "仕訳を登録しました");
      refreshCounts();
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const s = res?.suggestion;
  return (
    <>
      <h1>かんたん入力</h1>
      <p className="muted">「何に使ったか」を入力すると、勘定科目を自動で推定して仕訳を作ります。家事按分の設定がある科目は自動で事業分だけ経費にします。</p>
      <div className="grid grid-2">
        <div className="card stack">
          <div className="seg">
            <button className={direction === "expense" ? "on" : ""} onClick={() => setDirection("expense")}>
              支出（経費）
            </button>
            <button className={direction === "income" ? "on" : ""} onClick={() => setDirection("income")}>
              収入（売上）
            </button>
          </div>
          <div className="row">
            <Field label="日付">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="金額（税込）" style={{ flex: 1 }}>
              <AmountInput className="input-lg" value={amount} onChange={setAmount} />
            </Field>
          </div>
          <Field label={direction === "expense" ? "何に使った？（利用用途・お店）" : "何の収入？（取引先・内容）"}>
            <input
              type="text"
              className="input-lg"
              placeholder={direction === "expense" ? "例: Amazon でプリンターのインク / 電気代 / 打合せのカフェ代" : "例: 〇〇株式会社 Webサイト制作費"}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setManualAccount(null);
                setManualTax(null);
              }}
              autoFocus
            />
          </Field>
          <Field label={direction === "expense" ? "支払方法" : "受取方法"}>
            <div className="row">
              {PAY_OPTIONS[direction].map((p) => (
                <button key={p.account} className={pay === p.account ? "primary" : ""} onClick={() => setPay(p.account)} title={p.hint}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="row">
            <Field label="取引先（任意）" style={{ flex: 1 }}>
              <input type="text" value={partner} onChange={(e) => setPartner(e.target.value)} />
            </Field>
            <Field label="メモ（任意）" style={{ flex: 1 }}>
              <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </Field>
          </div>
          <RepeatOption date={date} value={repeat} onChange={setRepeat} />
          <Field label="領収書・請求書（任意・画像/PDF）">
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </Field>
        </div>

        <div className="card stack">
          <h3 style={{ margin: 0 }}>仕訳プレビュー</h3>
          {!s && <p className="muted">内容を入力すると、ここに推定結果が表示されます。</p>}
          {s && (
            <>
              <div className="row">
                <Field label="勘定科目" style={{ flex: 1 }}>
                  <AccountSelect value={s.account_id} onChange={(id) => setManualAccount(id)} />
                </Field>
                <Field label="消費税区分">
                  <TaxSelect value={s.tax_category} onChange={setManualTax} />
                </Field>
              </div>
              <div className="row small">
                <Confidence v={s.confidence} source={s.source} />
                <span className="muted">{s.reason}</span>
              </div>
              {res?.apportion && (
                <div className="alert info small">
                  家事按分: 事業割合 {res.apportion.business_ratio}%{res.apportion.basis ? `（${res.apportion.basis}）` : ""} を適用しました
                </div>
              )}
              <ErrorBox error={res?.error} />
              {res && res.lines.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>借方</th>
                      <th className="num">金額</th>
                      <th>貸方</th>
                      <th className="num">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairRows(res.lines).map((r, i) => (
                      <tr key={i}>
                        <td>{r.d ? name(r.d.account_id) : ""}{r.d?.tax_category && r.d.tax_category !== "out" ? <span className="muted small"> {TAX_LABELS[r.d.tax_category]}</span> : null}</td>
                        <td className="num">{r.d ? yen(r.d.amount) : ""}</td>
                        <td>{r.c ? name(r.c.account_id) : ""}{r.c?.tax_category && r.c.tax_category !== "out" ? <span className="muted small"> {TAX_LABELS[r.c.tax_category]}</span> : null}</td>
                        <td className="num">{r.c ? yen(r.c.amount) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!amount && <p className="muted small">金額を入力してください。</p>}
            </>
          )}
          <ErrorBox error={error} />
          <div className="row end">
            <button onClick={reset}>クリア</button>
            <button className="primary" disabled={busy || !res || !res.lines.length || !description.trim()} onClick={save}>
              {repeat > 1 ? `${repeat}か月分を登録` : "登録する"}
            </button>
          </div>
          <p className="muted small">登録した内容は学習され、次回から同じ内容は同じ科目で自動仕訳されます。</p>
        </div>
      </div>
    </>
  );
}

export function pairRows(lines: Line[]): Array<{ d?: Line; c?: Line }> {
  const d = lines.filter((l) => l.side === "debit");
  const c = lines.filter((l) => l.side === "credit");
  return Array.from({ length: Math.max(d.length, c.length) }, (_, i) => ({ d: d[i], c: c[i] }));
}
