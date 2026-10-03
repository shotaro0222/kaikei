import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp, useFetch } from "../app";
import { AmountInput, ErrorBox, Field } from "../components";
import { yen } from "../format";

interface PLLine { no: string; label: string; amount: number }
interface PL {
  sales: number; sales_only: number; misc_income: number; opening_inventory: number; purchases: number; subtotal: number; closing_inventory: number;
  cost_of_sales: number; gross_profit: number; expenses: PLLine[]; total_expenses: number; operating_income: number;
  income_before_deduction: number; blue_deduction: number; income: number;
}
interface BreakdownRow { partner: string; amount: number; business: number }
interface BSRow { label: string; opening: number; closing: number }
interface Statement {
  year: number;
  settings: Record<string, string>;
  pl: PL;
  bs: { assets: BSRow[]; liabilities: BSRow[]; total_assets: { opening: number; closing: number }; total_liabilities: { opening: number; closing: number } };
  months: Array<{ month: number; sales: number; misc_income: number; purchases: number }>;
  depreciation: Array<{ name: string; account: string; quantity: number; acquisition: string; cost: number; base: number; method: string; life: number | null; rate: number | string | null; months: number; depreciation: number; business_ratio: number; business_amount: number; closing_book: number }>;
  rent: BreakdownRow[];
  wages: BreakdownRow[];
  outsourcing: BreakdownRow[];
}

type Tab = "statement" | "return" | "consumption" | "guide";

export function TaxReturnPage() {
  const { year, settings } = useApp();
  const [tab, setTab] = useState<Tab>("statement");
  const blue = settings.filing_type !== "white";
  return (
    <>
      <h1>{year}年分 確定申告書類</h1>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <div className="seg">
          <button className={tab === "statement" ? "on" : ""} onClick={() => setTab("statement")}>{blue ? "青色申告決算書" : "収支内訳書"}</button>
          <button className={tab === "return" ? "on" : ""} onClick={() => setTab("return")}>申告書 第一表（所得税）</button>
          <button className={tab === "consumption" ? "on" : ""} onClick={() => setTab("consumption")}>消費税</button>
          <button className={tab === "guide" ? "on" : ""} onClick={() => setTab("guide")}>提出の手順</button>
        </div>
        <span className="spacer" />
        <button onClick={() => window.print()}>印刷 / PDF保存</button>
      </div>
      {tab === "statement" && (blue ? <BlueStatement year={year} /> : <WhiteStatement year={year} />)}
      {tab === "return" && <IncomeTaxReturn year={year} />}
      {tab === "consumption" && <ConsumptionTax year={year} />}
      {tab === "guide" && <Guide blue={blue} />}
    </>
  );
}

function Header({ s, title, year }: { s: Record<string, string>; title: string; year: number }) {
  return (
    <>
      <h2>令和{year - 2018}年分 {title}</h2>
      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr>
            <th style={{ width: 90 }}>住所</th><td>{s.address}</td>
            <th style={{ width: 90 }}>氏名</th><td>{s.owner_name}{s.owner_kana && <span className="small">（{s.owner_kana}）</span>}</td>
          </tr>
          <tr>
            <th>事業所所在地</th><td>{s.business_address}</td>
            <th>屋号</th><td>{s.business_name}</td>
          </tr>
          <tr>
            <th>業種名</th><td>{s.business_type}</td>
            <th>電話番号</th><td>{s.phone}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function Row({ no, label, v, bold }: { no?: string; label: string; v: number | null | undefined; bold?: boolean }) {
  return (
    <tr style={bold ? { fontWeight: 700 } : undefined}>
      <td className="no">{no}</td>
      <td>{label}</td>
      <td className="num">{v == null ? "" : yen(v)}</td>
    </tr>
  );
}

function useStatement(year: number) {
  return useFetch<Statement>(`/tax/${year}/statement`, [year]);
}

function BlueStatement({ year }: { year: number }) {
  const { data, error } = useStatement(year);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">読み込み中…</p>;
  const { pl, bs, settings: s } = data;
  const exp = pl.expenses;
  const half = Math.ceil(exp.length / 2);
  const deductionWarn = Number(s.blue_deduction) === 650000;
  return (
    <>
      {deductionWarn && (
        <div className="alert info no-print small">
          青色申告特別控除65万円は、e-Taxで申告する（または優良な電子帳簿保存を行う）場合に適用されます。紙で提出する場合は55万円になります（事業者設定で変更できます）。
        </div>
      )}
      <div className="form-sheet page-break">
        <Header s={s} title="所得税青色申告決算書（一般用）" year={year} />
        <h3>損益計算書（自 1月1日 至 12月31日）</h3>
        <div className="form-grid">
          <table>
            <tbody>
              <Row no="①" label="売上（収入）金額（雑収入を含む）" v={pl.sales} bold />
              <Row no="②" label="期首商品（製品）棚卸高" v={pl.opening_inventory} />
              <Row no="③" label="仕入金額（製品製造原価）" v={pl.purchases} />
              <Row no="④" label="小計（②＋③）" v={pl.subtotal} />
              <Row no="⑤" label="期末商品（製品）棚卸高" v={pl.closing_inventory} />
              <Row no="⑥" label="差引原価（④－⑤）" v={pl.cost_of_sales} />
              <Row no="⑦" label="差引金額（①－⑥）" v={pl.gross_profit} bold />
              {exp.slice(0, half).map((e) => <Row key={e.no} no={e.no} label={e.label || "（任意科目）"} v={e.label ? e.amount : null} />)}
            </tbody>
          </table>
          <table>
            <tbody>
              {exp.slice(half).map((e) => <Row key={e.no} no={e.no} label={e.label || "（任意科目）"} v={e.label ? e.amount : null} />)}
              <Row no="㉜" label="経費 計" v={pl.total_expenses} bold />
              <Row no="㉝" label="差引金額（⑦－㉜）" v={pl.operating_income} bold />
              <Row label="各種引当金・準備金等（繰戻額・繰入額）" v={0} />
              <Row no="㊸" label="青色申告特別控除前の所得金額" v={pl.income_before_deduction} bold />
              <Row no="㊹" label="青色申告特別控除額" v={pl.blue_deduction} />
              <Row no="㊺" label="所得金額（㊸－㊹）" v={pl.income} bold />
            </tbody>
          </table>
        </div>
        <p className="small">※ 雑収入 {yen(pl.misc_income)} 円を①に含んでいます。</p>
      </div>

      <div className="form-sheet page-break" style={{ marginTop: 16 }}>
        <h2>損益計算書の内訳（2ページ）</h2>
        <div className="form-grid">
          <div>
            <h3>月別売上（収入）金額及び仕入金額</h3>
            <table>
              <thead><tr><th>月</th><th className="num">売上（収入）金額</th><th className="num">仕入金額</th></tr></thead>
              <tbody>
                {data.months.map((m) => <tr key={m.month}><td>{m.month}月</td><td className="num">{yen(m.sales)}</td><td className="num">{yen(m.purchases)}</td></tr>)}
                <tr><td>家事消費等</td><td className="num">0</td><td /></tr>
                <tr><td>雑収入</td><td className="num">{yen(pl.misc_income)}</td><td /></tr>
                <tr style={{ fontWeight: 700 }}><td>計</td><td className="num">{yen(pl.sales)}</td><td className="num">{yen(pl.purchases)}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3>給料賃金の内訳</h3>
            <Breakdown rows={data.wages} />
            <h3>外注工賃の内訳</h3>
            <Breakdown rows={data.outsourcing} />
            <h3>地代家賃の内訳</h3>
            <Breakdown rows={data.rent} />
          </div>
        </div>
      </div>

      <div className="form-sheet page-break" style={{ marginTop: 16 }}>
        <h2>減価償却費の計算（3ページ）</h2>
        <DepreciationTable rows={data.depreciation} />
      </div>

      <div className="form-sheet" style={{ marginTop: 16 }}>
        <h2>貸借対照表（資産負債調）（4ページ）</h2>
        <div className="form-grid">
          <BSTable title="資産の部" rows={bs.assets} total={bs.total_assets} />
          <BSTable title="負債・資本の部" rows={bs.liabilities} total={bs.total_liabilities} />
        </div>
        {bs.total_assets.closing !== bs.total_liabilities.closing && (
          <div className="alert error">貸借が一致していません。期首残高の設定を確認してください。</div>
        )}
        <p className="small">※ 期首の事業主貸・事業主借は0円とし、元入金に含めます。</p>
      </div>
    </>
  );
}

function Breakdown({ rows }: { rows: BreakdownRow[] }) {
  if (!rows.length) return <p className="small muted">該当なし</p>;
  return (
    <table>
      <thead><tr><th>支払先</th><th className="num">本年中の支払額</th><th className="num">うち必要経費算入額</th></tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.partner}><td>{r.partner}</td><td className="num">{yen(r.amount)}</td><td className="num">{yen(r.business)}</td></tr>)}
      </tbody>
    </table>
  );
}

function DepreciationTable({ rows }: { rows: Statement["depreciation"] }) {
  const sum = rows.reduce((s, r) => ({ d: s.d + r.depreciation, b: s.b + r.business_amount, c: s.c + r.closing_book }), { d: 0, b: 0, c: 0 });
  return (
    <div className="table-wrap">
      <table className="small">
        <thead>
          <tr>
            <th>資産の名称</th><th>数量</th><th>取得年月</th><th className="num">取得価額</th><th className="num">償却の基礎</th><th>償却方法</th>
            <th>耐用年数</th><th>償却率</th><th>本年中の償却期間</th><th className="num">本年分の償却費</th><th>事業専用割合</th><th className="num">必要経費算入額</th><th className="num">未償却残高</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.name}</td><td>{r.quantity}</td><td>{r.acquisition.slice(0, 7)}</td><td className="num">{yen(r.cost)}</td><td className="num">{yen(r.base)}</td>
              <td>{r.method}</td><td>{r.life ? `${r.life}年` : "-"}</td><td>{r.rate ?? "-"}</td><td>{r.months ? `${r.months}/12` : "-"}</td>
              <td className="num">{yen(r.depreciation)}</td><td>{r.business_ratio}%</td><td className="num">{yen(r.business_amount)}</td><td className="num">{yen(r.closing_book)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={9}>計</td><td className="num">{yen(sum.d)}</td><td /><td className="num">{yen(sum.b)}</td><td className="num">{yen(sum.c)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BSTable({ title, rows, total }: { title: string; rows: BSRow[]; total: { opening: number; closing: number } }) {
  return (
    <table>
      <thead>
        <tr><th>{title}</th><th className="num">1月1日（期首）</th><th className="num">12月31日（期末）</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}><td>{r.label}</td><td className="num">{yen(r.opening)}</td><td className="num">{yen(r.closing)}</td></tr>
        ))}
        <tr style={{ fontWeight: 700 }}><td>合計</td><td className="num">{yen(total.opening)}</td><td className="num">{yen(total.closing)}</td></tr>
      </tbody>
    </table>
  );
}

const WHITE_OTHER = ["租税公課", "荷造運賃", "水道光熱費", "旅費交通費", "通信費", "広告宣伝費", "接待交際費", "損害保険料", "修繕費", "消耗品費", "福利厚生費"];
const IROHA = "イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテ";

function WhiteStatement({ year }: { year: number }) {
  const { data, error } = useStatement(year);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">読み込み中…</p>;
  const { pl, settings: s } = data;
  const get = (label: string) => pl.expenses.find((e) => e.label === label)?.amount ?? 0;
  const main = ["給料賃金", "外注工賃", "減価償却費", "貸倒金", "地代家賃", "利子割引料"];
  const others = [
    ...WHITE_OTHER.map((l) => ({ label: l, amount: get(l) })),
    ...pl.expenses.filter((e) => e.label && !main.includes(e.label) && !WHITE_OTHER.includes(e.label) && e.label !== "雑費").map((e) => ({ label: e.label, amount: e.amount })),
    { label: "雑費", amount: get("雑費") },
  ];
  const otherTotal = others.reduce((a, b) => a + b.amount, 0);
  return (
    <div className="form-sheet">
      <Header s={s} title="収支内訳書（一般用）" year={year} />
      <div className="form-grid">
        <table>
          <tbody>
            <Row no="①" label="売上（収入）金額" v={pl.sales_only} />
            <Row no="②" label="家事消費" v={0} />
            <Row no="③" label="その他の収入" v={pl.misc_income} />
            <Row no="④" label="計（①＋②＋③）" v={pl.sales} bold />
            <Row no="⑤" label="期首商品（製品）棚卸高" v={pl.opening_inventory} />
            <Row no="⑥" label="仕入金額" v={pl.purchases} />
            <Row no="⑦" label="小計（⑤＋⑥）" v={pl.subtotal} />
            <Row no="⑧" label="期末商品（製品）棚卸高" v={pl.closing_inventory} />
            <Row no="⑨" label="差引原価（⑦－⑧）" v={pl.cost_of_sales} />
            <Row no="⑩" label="差引金額（④－⑨）" v={pl.gross_profit} bold />
            {main.map((l, i) => <Row key={l} no={["⑪", "⑫", "⑬", "⑭", "⑮", "⑯"][i]} label={l} v={get(l)} />)}
          </tbody>
        </table>
        <table>
          <tbody>
            <tr><td className="no">⑰</td><td colSpan={2}>その他の経費</td></tr>
            {others.map((o, i) => <Row key={o.label} no={IROHA[i]} label={o.label} v={o.amount} />)}
            <Row label="小計" v={otherTotal} />
            <Row no="⑱" label="経費計（⑪〜⑰）" v={pl.total_expenses} bold />
            <Row no="⑲" label="専従者控除前の所得金額（⑩－⑱）" v={pl.operating_income} />
            <Row no="⑳" label="専従者控除" v={0} />
            <Row no="㉑" label="所得金額（⑲－⑳）" v={pl.operating_income} bold />
          </tbody>
        </table>
      </div>
      <h3>減価償却費の計算</h3>
      <DepreciationTable rows={data.depreciation} />
      <h3>地代家賃の内訳</h3>
      <Breakdown rows={data.rent} />
    </div>
  );
}

interface IncomeTax {
  filing_type: string;
  business_sales: number;
  business_income: number;
  blue_deduction: number;
  inputs: Record<string, string>;
  result: {
    total_income: number; basic_deduction: number; total_deductions: number; taxable_income: number; income_tax: number;
    reconstruction_tax: number; total_tax: number; withholding: number; prepaid: number; payable: number;
  };
}

const DEDUCTION_FIELDS: Array<[string, string, string?]> = [
  ["social_insurance", "社会保険料控除", "国民健康保険・国民年金・任意継続等の支払額"],
  ["small_business_mutual", "小規模企業共済等掛金控除", "小規模企業共済・iDeCo"],
  ["life_insurance", "生命保険料控除", "控除額（最大12万円）"],
  ["earthquake_insurance", "地震保険料控除", "控除額（最大5万円）"],
  ["medical", "医療費控除", "控除額（支払額−保険補填−10万円）"],
  ["donation", "寄附金控除", "ふるさと納税等（寄附額−2,000円）"],
  ["spouse", "配偶者（特別）控除"],
  ["dependents", "扶養控除"],
  ["other", "その他の控除", "寡婦・ひとり親・勤労学生・障害者控除"],
];
const OTHER_INCOME: Array<[string, string, string?]> = [
  ["salary_income", "給与所得", "給与所得控除後の金額（源泉徴収票の「給与所得控除後の金額」）"],
  ["misc_income", "雑所得"],
  ["other_income", "その他の総合課税所得"],
];

function IncomeTaxReturn({ year }: { year: number }) {
  const { toast } = useApp();
  const { data, error, reload } = useFetch<IncomeTax>(`/tax/${year}/income`, [year]);
  const [form, setForm] = useState<Record<string, number | "">>({});
  const [saveErr, setSaveErr] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const f: Record<string, number | ""> = {};
    for (const k of [...DEDUCTION_FIELDS, ...OTHER_INCOME].map((x) => x[0]).concat(["withholding", "prepaid", "basic_override"])) {
      const v = data.inputs[k];
      f[k] = v == null || v === "" ? "" : Number(v);
    }
    setForm(f);
  }, [data]);

  const save = async () => {
    try {
      await api.put(`/tax/${year}/inputs`, form);
      toast("保存しました");
      reload();
    } catch (e) {
      setSaveErr((e as Error).message);
    }
  };
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">読み込み中…</p>;
  const r = data.result;
  const input = (k: string, label: string, hint?: string) => (
    <Field key={k} label={label}>
      <AmountInput value={form[k] ?? ""} onChange={(v) => setForm({ ...form, [k]: v })} />
      {hint && <span className="small" style={{ fontWeight: 400 }}>{hint}</span>}
    </Field>
  );
  return (
    <div className="grid grid-2">
      <div className="card stack no-print">
        <h3 style={{ margin: 0 }}>所得控除などの入力</h3>
        <div className="grid grid-2">
          {DEDUCTION_FIELDS.map(([k, l, h]) => input(k, l, h))}
          {input("basic_override", "基礎控除（手入力する場合）", `空欄なら自動計算（${yen(r.basic_deduction)}円）`)}
        </div>
        <h3 style={{ margin: "8px 0 0" }}>事業所得以外の所得</h3>
        <div className="grid grid-2">{OTHER_INCOME.map(([k, l, h]) => input(k, l, h))}</div>
        <h3 style={{ margin: "8px 0 0" }}>源泉徴収・予定納税</h3>
        <div className="grid grid-2">
          {input("withholding", "源泉徴収税額", "報酬から天引きされた所得税（支払調書等）")}
          {input("prepaid", "予定納税額")}
        </div>
        <ErrorBox error={saveErr} />
        <div className="row end">
          <button className="primary" onClick={save}>保存して再計算</button>
        </div>
      </div>
      <div className="form-sheet">
        <h2>確定申告書 第一表（所得税）概算</h2>
        <table>
          <tbody>
            <tr><th colSpan={3}>収入金額等</th></tr>
            <Row no="ア" label="事業（営業等）" v={data.business_sales} />
            <tr><th colSpan={3}>所得金額等</th></tr>
            <Row no="①" label={`事業（営業等）所得${data.filing_type === "blue" ? `（青色申告特別控除 ${yen(data.blue_deduction)} 後）` : ""}`} v={data.business_income} />
            <Row no="⑥" label="給与" v={Number(form.salary_income) || 0} />
            <Row label="雑・その他" v={(Number(form.misc_income) || 0) + (Number(form.other_income) || 0)} />
            <Row no="⑫" label="合計" v={r.total_income} bold />
            <tr><th colSpan={3}>所得から差し引かれる金額</th></tr>
            {DEDUCTION_FIELDS.map(([k, l]) => <Row key={k} label={l} v={Number(form[k]) || 0} />)}
            <Row label="基礎控除" v={r.basic_deduction} />
            <Row no="㉙" label="合計" v={r.total_deductions} bold />
            <tr><th colSpan={3}>税金の計算</th></tr>
            <Row no="㉚" label="課税される所得金額（千円未満切捨て）" v={r.taxable_income} />
            <Row no="㉛" label="上の㉚に対する税額" v={r.income_tax} />
            <Row no="㊷" label="復興特別所得税額（2.1%）" v={r.reconstruction_tax} />
            <Row no="㊸" label="所得税及び復興特別所得税の額" v={r.total_tax} bold />
            <Row no="㊻" label="源泉徴収税額" v={r.withholding} />
            <Row no="㊽" label="予定納税額" v={r.prepaid} />
            <Row no="㊾/㊿" label={r.payable >= 0 ? "納める税金" : "還付される税金"} v={Math.abs(r.payable)} bold />
          </tbody>
        </table>
        <p className="small">
          ※ 概算です。各種控除の適用要件、税制改正（基礎控除の特例等）は国税庁の確定申告書等作成コーナーで最終確認してください。住民税・事業税は含みません。
        </p>
      </div>
    </div>
  );
}

interface Consumption {
  method: string;
  buckets: { sales: Record<string, number>; purchases: Record<string, number> };
  result: { taxable_sales_10: number; taxable_sales_8: number; tax_base_10: number; tax_base_8: number; output_tax: number; input_tax: number; national_tax: number; local_tax: number; total: number; deemed_rate?: number };
  base_period_sales: number | null;
}

const METHOD_LABEL: Record<string, string> = { exempt: "免税事業者", general: "本則課税（一般）", simplified: "簡易課税", twenty_percent: "2割特例" };

function ConsumptionTax({ year }: { year: number }) {
  const { data, error } = useFetch<Consumption>(`/tax/${year}/consumption`, [year]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">読み込み中…</p>;
  const r = data.result;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>消費税の集計（{METHOD_LABEL[data.method]}）</h3>
      {data.method === "exempt" && (
        <div className="alert info small">
          免税事業者として設定されています。インボイス登録をした場合や基準期間（{year - 2}年）の課税売上高が1,000万円を超える場合は、事業者設定で計算方法を変更してください。
          {data.base_period_sales != null && <> 基準期間の売上: ¥{yen(data.base_period_sales)}</>}
        </div>
      )}
      <div className="grid grid-2">
        <table>
          <thead><tr><th>区分</th><th className="num">売上（税込）</th><th className="num">仕入・経費（税込）</th></tr></thead>
          <tbody>
            <tr><td>課税 10%</td><td className="num">{yen(data.buckets.sales.taxable10)}</td><td className="num">{yen(data.buckets.purchases.taxable10)}</td></tr>
            <tr><td>課税 8%（軽減）</td><td className="num">{yen(data.buckets.sales.taxable8)}</td><td className="num">{yen(data.buckets.purchases.taxable8)}</td></tr>
            <tr><td>非課税</td><td className="num">{yen(data.buckets.sales.exempt)}</td><td className="num">{yen(data.buckets.purchases.exempt)}</td></tr>
            <tr><td>輸出免税</td><td className="num">{yen(data.buckets.sales.export)}</td><td className="num">{yen(data.buckets.purchases.export)}</td></tr>
          </tbody>
        </table>
        <table>
          <tbody>
            <Row label="課税標準額（10%）" v={r.tax_base_10} />
            <Row label="課税標準額（8%）" v={r.tax_base_8} />
            <Row label="売上に係る消費税額（国税）" v={r.output_tax} />
            <Row label={`控除対象仕入税額${r.deemed_rate ? `（みなし仕入率 ${r.deemed_rate * 100}%）` : data.method === "twenty_percent" ? "（売上税額の80%）" : ""}`} v={r.input_tax} />
            <Row label="差引税額（国税）" v={r.national_tax} />
            <Row label="地方消費税" v={r.local_tax} />
            <Row label="納付税額 合計" v={r.total} bold />
          </tbody>
        </table>
      </div>
      <p className="small muted">※ 税込経理・積上げ計算を簡略化した概算です。本則課税ではインボイス（適格請求書）の保存が仕入税額控除の要件です。</p>
    </div>
  );
}

function Guide({ blue }: { blue: boolean }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>確定申告の手順（翌年2月16日〜3月15日）</h3>
      <ol>
        <li><a href="#/closing">決算整理</a>（減価償却・家事按分・棚卸）を実行する</li>
        <li>{blue ? "青色申告決算書" : "収支内訳書"}タブの内容を確認し、印刷またはPDFで保存する</li>
        <li>「申告書 第一表」タブで社会保険料・生命保険料などの控除額と源泉徴収税額を入力する</li>
        <li>
          国税庁「<a href="https://www.keisan.nta.go.jp/" target="_blank" rel="noreferrer">確定申告書等作成コーナー</a>」で「決算書・収支内訳書」→「所得税」の順に、本アプリの金額を転記して e-Tax で送信する（マイナンバーカード方式）
        </li>
        <li>{blue ? "e-Tax で提出すると青色申告特別控除は65万円（紙提出は55万円）" : "白色申告は帳簿の保存（7年）が必要です"}</li>
        <li>消費税の課税事業者は「消費税」タブの金額をもとに消費税の申告（3月31日まで）を行う</li>
        <li>帳簿（仕訳帳・総勘定元帳）は <a href="#/reports">帳簿・レポート</a> から PDF/CSV で保存し、領収書とともに7年間保存する</li>
      </ol>
      <p className="small muted">
        本アプリは国税庁の様式に沿って金額を集計しますが、申告内容の最終確認はご自身または税理士の責任で行ってください。
      </p>
    </div>
  );
}
