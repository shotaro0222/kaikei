import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "./app";
import { CATEGORY_LABELS, TAX_LABELS, yen } from "./format";
import type { Account, Category, TaxCategory } from "./types";

export function AccountSelect({
  value, onChange, categories, includeInactive, placeholder = "科目を選択", className,
}: {
  value: number | "" | null;
  onChange: (id: number, account: Account) => void;
  categories?: Category[];
  includeInactive?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const { accounts } = useApp();
  const groups = useMemo(() => {
    const list = accounts.filter((a) => (includeInactive || a.active || a.id === value) && (!categories || categories.includes(a.category)));
    const order: Category[] = ["expense", "revenue", "asset", "liability", "equity"];
    return order.map((c) => ({ c, items: list.filter((a) => a.category === c) })).filter((g) => g.items.length);
  }, [accounts, categories, includeInactive, value]);
  return (
    <select
      className={className}
      value={value ?? ""}
      onChange={(e) => {
        const id = Number(e.target.value);
        const a = accounts.find((x) => x.id === id);
        if (a) onChange(id, a);
      }}
    >
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.c} label={CATEGORY_LABELS[g.c]}>
          {g.items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function TaxSelect({ value, onChange }: { value: TaxCategory | undefined; onChange: (t: TaxCategory) => void }) {
  return (
    <select value={value ?? "out"} onChange={(e) => onChange(e.target.value as TaxCategory)}>
      {(Object.keys(TAX_LABELS) as TaxCategory[]).map((k) => (
        <option key={k} value={k}>
          {TAX_LABELS[k]}
        </option>
      ))}
    </select>
  );
}

export function AmountInput({ value, onChange, className, placeholder }: { value: number | ""; onChange: (v: number | "") => void; className?: string; placeholder?: string }) {
  const [text, setText] = useState(value === "" ? "" : yen(value));
  useEffect(() => {
    const parsed = Number(text.replace(/[,，]/g, "").normalize("NFKC"));
    if (value === "" ? text !== "" : parsed !== value) setText(value === "" ? "" : yen(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      placeholder={placeholder ?? "0"}
      value={text}
      style={{ textAlign: "right" }}
      onChange={(e) => {
        const t = e.target.value.normalize("NFKC");
        setText(t);
        const n = Number(t.replace(/[,¥円\s]/g, ""));
        onChange(t.trim() === "" || Number.isNaN(n) ? "" : Math.round(n));
      }}
      onBlur={() => value !== "" && setText(yen(value))}
    />
  );
}

export function Money({ v, sign }: { v: number | null | undefined; sign?: boolean }) {
  if (v == null) return null;
  return <span className={sign && v < 0 ? "neg" : undefined}>{yen(v)}</span>;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="row end" style={{ marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <div className="alert error">{error}</div> : null;
}

export function Field({ label, children, style }: { label: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function YearPicker() {
  const { year, setYear } = useApp();
  const now = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => now + 1 - i);
  if (!years.includes(year)) years.push(year);
  return (
    <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="会計年度">
      {years.map((y) => (
        <option key={y} value={y}>
          {y}年分（令和{y - 2018}年）
        </option>
      ))}
    </select>
  );
}

export function useAccountName() {
  const { accounts } = useApp();
  const map = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  return (id: number) => map.get(id) ?? `#${id}`;
}

export function Confidence({ v, source }: { v: number; source?: string }) {
  const label = source === "learned" ? "学習" : source === "user" ? "ルール" : source === "dictionary" ? "辞書" : source === "ai" ? "AI" : "仮";
  return <span className={`tag ${v >= 0.8 ? "ok" : v >= 0.5 ? "" : "warn"}`}>{label}</span>;
}
