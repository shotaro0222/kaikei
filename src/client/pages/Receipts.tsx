import { useEffect, useRef, useState } from "react";
import { api, qs } from "../api";
import { useApp, useFetch, useRoute } from "../app";
import { AmountInput, ErrorBox, Field, Modal } from "../components";
import { yen } from "../format";

interface Receipt {
  id: number;
  storage: "r2" | "external";
  external_url: string | null;
  file_name: string;
  mime_type: string | null;
  size: number | null;
  sha256: string | null;
  doc_type: string;
  issued_date: string | null;
  amount: number | null;
  partner: string | null;
  memo: string | null;
  journal_id: number | null;
  journal_date: string | null;
  journal_description: string | null;
  source: string;
  uploaded_at: string;
}

const DOC_TYPES: Record<string, string> = { receipt: "領収書", invoice: "請求書", quote: "見積書", contract: "契約書", other: "その他" };

export function ReceiptsPage() {
  const { refreshCounts, toast } = useApp();
  const { params } = useRoute();
  const [filters, setFilters] = useState({ from: "", to: "", min: "", max: "", partner: "", unlinked: params.get("unlinked") === "1" ? "1" : "" });
  const list = useFetch<Receipt[]>(`/receipts${qs(filters)}`);
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [linking, setLinking] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    try {
      for (const f of arr) {
        const fd = new FormData();
        fd.append("file", f);
        await api.post("/receipts", fd);
      }
      toast(`${arr.length}件をアップロードしました`);
      list.reload();
      refreshCounts();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const f = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement>) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <>
      <div className="row between">
        <h1>領収書・請求書（電子保存）</h1>
        <button onClick={() => setLinking(true)}>外部ドライブのファイルを紐付け</button>
      </div>
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files);
        }}
      >
        ここに領収書・請求書の画像やPDFをドロップ、またはクリックして選択（Cloudflare R2 に保存）
        <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      <p className="muted small">
        電子帳簿保存法の検索要件（取引年月日・金額・取引先）で検索できるよう、日付・金額・取引先を入力して仕訳と紐付けてください。ファイルは改ざん検知用のハッシュ値とともに保存され、削除しても履歴が残ります。
      </p>
      <ErrorBox error={error || list.error} />
      <div className="card row">
        <Field label="取引日">
          <div className="row" style={{ gap: 4 }}>
            <input type="date" value={filters.from} onChange={f("from")} />〜<input type="date" value={filters.to} onChange={f("to")} />
          </div>
        </Field>
        <Field label="金額">
          <div className="row" style={{ gap: 4 }}>
            <input type="number" value={filters.min} onChange={f("min")} style={{ width: 110 }} />〜<input type="number" value={filters.max} onChange={f("max")} style={{ width: 110 }} />
          </div>
        </Field>
        <Field label="取引先">
          <input type="text" value={filters.partner} onChange={f("partner")} />
        </Field>
        <label className="row small">
          <input type="checkbox" checked={filters.unlinked === "1"} onChange={(e) => setFilters({ ...filters, unlinked: e.target.checked ? "1" : "" })} />
          未紐付けのみ
        </label>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>取引日</th>
              <th>種類</th>
              <th>取引先</th>
              <th className="num">金額</th>
              <th>ファイル</th>
              <th>仕訳</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setEditing(r)}>
                <td>{r.issued_date ?? <span className="tag warn">未入力</span>}</td>
                <td>{DOC_TYPES[r.doc_type] ?? r.doc_type}</td>
                <td>{r.partner}</td>
                <td className="num">{yen(r.amount)}</td>
                <td>
                  {r.storage === "external" ? "🔗" : "📄"} {r.file_name}
                  {r.source === "email" && <span className="tag" style={{ marginLeft: 4 }}>メール</span>}
                </td>
                <td>{r.journal_id ? <span className="tag ok">{r.journal_date} {r.journal_description}</span> : <span className="tag warn">未紐付け</span>}</td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  書類がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <ReceiptModal
          r={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
            refreshCounts();
          }}
        />
      )}
      {linking && <LinkModal onClose={() => setLinking(false)} onSaved={() => (setLinking(false), list.reload(), refreshCounts())} />}
    </>
  );
}

function ReceiptModal({ r, onClose, onSaved }: { r: Receipt; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState({ doc_type: r.doc_type, issued_date: r.issued_date ?? "", amount: r.amount ?? ("" as number | ""), partner: r.partner ?? "", memo: r.memo ?? "", journal_id: r.journal_id });
  const [cands, setCands] = useState<Array<{ id: number; date: string; description: string; amount: number; score: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const isImage = r.mime_type?.startsWith("image/");
  const isPdf = r.mime_type === "application/pdf";

  useEffect(() => {
    api.get<typeof cands>(`/receipts/${r.id}/candidates`).then(setCands).catch(() => {});
  }, [r.id]);

  const save = async (patch: Partial<typeof m> = {}) => {
    try {
      await api.put(`/receipts/${r.id}`, { ...m, ...patch, amount: (patch.amount ?? m.amount) === "" ? null : patch.amount ?? m.amount });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={r.file_name}
      onClose={onClose}
      footer={
        <>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm("この書類を削除しますか？（電子帳簿保存のため履歴は残ります）")) return;
              await api.del(`/receipts/${r.id}`);
              onSaved();
            }}
          >
            削除
          </button>
          <span className="spacer" />
          <a className="btn" href={`/api/receipts/${r.id}/file`} target="_blank" rel="noreferrer">
            {r.storage === "external" ? "外部ドライブで開く" : "原本を開く"}
          </a>
          <button className="primary" onClick={() => save()}>
            保存
          </button>
        </>
      }
    >
      <div className="grid grid-2">
        <div>
          {r.storage === "r2" && isImage && <img src={`/api/receipts/${r.id}/file`} alt={r.file_name} style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 6 }} />}
          {r.storage === "r2" && isPdf && <iframe title="pdf" src={`/api/receipts/${r.id}/file`} style={{ width: "100%", height: 420, border: "1px solid var(--line)" }} />}
          {r.storage === "external" && <p className="muted">外部ドライブ: <a href={r.external_url ?? "#"} target="_blank" rel="noreferrer">{r.external_url}</a></p>}
          <p className="muted small">
            受付: {r.uploaded_at}(UTC) / {r.source === "email" ? "メール受信" : r.source === "link" ? "外部リンク" : "アップロード"}
            {r.sha256 && <><br />SHA-256: {r.sha256.slice(0, 16)}…</>}
          </p>
        </div>
        <div className="stack">
          <Field label="書類の種類">
            <select value={m.doc_type} onChange={(e) => setM({ ...m, doc_type: e.target.value })}>
              {Object.entries(DOC_TYPES).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="取引年月日">
            <input type="date" value={m.issued_date} onChange={(e) => setM({ ...m, issued_date: e.target.value })} />
          </Field>
          <Field label="金額（税込）">
            <AmountInput value={m.amount} onChange={(v) => setM({ ...m, amount: v })} />
          </Field>
          <Field label="取引先">
            <input type="text" value={m.partner} onChange={(e) => setM({ ...m, partner: e.target.value })} />
          </Field>
          <Field label="メモ">
            <input type="text" value={m.memo} onChange={(e) => setM({ ...m, memo: e.target.value })} />
          </Field>
          <div>
            <b className="small">紐付ける仕訳</b>
            {m.journal_id ? (
              <div className="row small">
                <a href={`#/journals?id=${m.journal_id}`}>仕訳 #{m.journal_id}</a>
                <button className="link" onClick={() => setM({ ...m, journal_id: null })}>解除</button>
              </div>
            ) : (
              <>
                {cands.length === 0 && <p className="muted small">候補なし（日付・金額を入力して保存すると候補が表示されます）</p>}
                {cands.map((c) => (
                  <div key={c.id} className="row small">
                    <button className="link" onClick={() => save({ journal_id: c.id })}>この仕訳に紐付け</button>
                    {c.date} {c.description} ¥{yen(c.amount)} {c.score >= 3 && <span className="tag ok">一致</span>}
                  </div>
                ))}
              </>
            )}
          </div>
          <ErrorBox error={error} />
        </div>
      </div>
    </Modal>
  );
}

function LinkModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState({ url: "", file_name: "", doc_type: "receipt", issued_date: "", amount: "" as number | "", partner: "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="外部ドライブのファイルを紐付け"
      onClose={onClose}
      footer={
        <button className="primary" onClick={() => api.post("/receipts/link", { ...m, amount: m.amount === "" ? null : m.amount }).then(onSaved).catch((e) => setError(e.message))}>
          登録
        </button>
      }
    >
      <p className="muted small">Google ドライブ・Dropbox・OneDrive などに保存している書類の共有リンクを登録します。原本は外部ドライブ側で保存期間（7年）保管してください。</p>
      <div className="stack">
        <Field label="共有リンク（https）">
          <input type="url" value={m.url} onChange={(e) => setM({ ...m, url: e.target.value })} placeholder="https://drive.google.com/file/d/..." />
        </Field>
        <Field label="ファイル名">
          <input type="text" value={m.file_name} onChange={(e) => setM({ ...m, file_name: e.target.value })} />
        </Field>
        <div className="row">
          <Field label="取引年月日"><input type="date" value={m.issued_date} onChange={(e) => setM({ ...m, issued_date: e.target.value })} /></Field>
          <Field label="金額"><AmountInput value={m.amount} onChange={(v) => setM({ ...m, amount: v })} /></Field>
          <Field label="取引先"><input type="text" value={m.partner} onChange={(e) => setM({ ...m, partner: e.target.value })} /></Field>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
