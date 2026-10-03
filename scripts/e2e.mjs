// ローカル（空のD1）に対するAPIのシナリオテスト: npm run build && npm run db:migrate:local && npx vite preview --port 8787 の後に実行
// 使い方: node scripts/e2e.mjs  （E2E_BASE / E2E_PASSWORD で接続先を変更可）
const BASE = (process.env.E2E_BASE ?? "http://localhost:8787") + "/api";
const PASSWORD = process.env.E2E_PASSWORD ?? "changeme";
let cookie = "";
let fails = 0;
async function call(method, path, body, raw) {
  const headers = { cookie };
  let b;
  if (body instanceof FormData) b = body;
  else if (body !== undefined) { b = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const res = await fetch(BASE + path, { method, headers, body: b, redirect: "manual" });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!raw && !res.ok) { console.log("FAIL", method, path, res.status, data); fails++; }
  return raw ? { status: res.status, data, headers: res.headers } : data;
}
const check = (name, cond, extra) => { console.log(cond ? "ok  " : "NG  ", name, cond ? "" : JSON.stringify(extra)); if (!cond) fails++; };
const Y = 2026;

check("unauth 401", (await call("GET", "/me", undefined, true)).status === 401);
check("wrong pw 401", (await call("POST", "/login", { password: "x" }, true)).status === 401);
await call("POST", "/login", { password: PASSWORD });
check("me", (await call("GET", "/me")).ok);

const accounts = await call("GET", "/accounts");
const A = Object.fromEntries(accounts.map((a) => [a.name, a.id]));
await call("PUT", "/settings", { owner_name: "山田 太郎", business_name: "ヤマダ制作所", filing_type: "blue", blue_deduction: "650000", consumption_tax: "twenty_percent" });
await call("PUT", `/opening/${Y}`, [{ account_id: A["普通預金"], amount: 1000000 }, { account_id: A["元入金"], amount: 1000000 }]);

let s = await call("POST", "/quick/suggest", { description: "東京電力 電気代", amount: 5000, direction: "expense", counter_account_id: A["普通預金"] });
check("suggest 水道光熱費", s.suggestion.account_id === A["水道光熱費"], s);
await call("PUT", "/apportion", { account_id: A["水道光熱費"], business_ratio: 30, timing: "entry", basis: "床面積" });
s = await call("POST", "/quick/suggest", { description: "東京電力 電気代", amount: 5000, direction: "expense", counter_account_id: A["普通預金"] });
check("entry apportion 3 lines", s.lines.length === 3 && s.lines[0].amount === 1500 && s.lines[1].amount === 3500, s.lines);
const j1 = await call("POST", "/journals", { date: `${Y}-01-20`, description: "東京電力 電気代", source: "quick", lines: s.lines, learn: { text: "東京電力 電気代", direction: "expense", account_id: s.suggestion.account_id, tax_category: s.suggestion.tax_category } });
check("journal created", j1.id > 0, j1);

// 不正な仕訳
const bad = await call("POST", "/journals", { date: `${Y}-01-20`, description: "x", lines: [{ side: "debit", account_id: A["現金"], amount: 100 }, { side: "credit", account_id: A["売上高"], amount: 90 }] }, true);
check("unbalanced rejected", bad.status === 400 && /貸借/.test(bad.data.error), bad);

// 売上
await call("POST", "/journals", { date: `${Y}-02-28`, description: "Web制作", partner: "株式会社ABC", lines: [{ side: "debit", account_id: A["売掛金"], amount: 3300000, tax_category: "out" }, { side: "credit", account_id: A["売上高"], amount: 3300000, tax_category: "taxable10" }] });
// 家賃（決算時按分）
await call("PUT", "/apportion", { account_id: A["地代家賃"], business_ratio: 30, timing: "year_end", basis: "10㎡/33㎡" });
await call("POST", "/journals", { date: `${Y}-03-31`, description: "家賃 1-12月", partner: "大家さん", lines: [{ side: "debit", account_id: A["地代家賃"], amount: 1200000, tax_category: "exempt" }, { side: "credit", account_id: A["普通預金"], amount: 1200000 }] });
// PC購入
await call("POST", "/journals", { date: `${Y}-04-10`, description: "ノートPC", lines: [{ side: "debit", account_id: A["工具器具備品"], amount: 300000, tax_category: "taxable10" }, { side: "credit", account_id: A["普通預金"], amount: 300000 }] });
const asset = await call("POST", "/assets", { name: "ノートPC", account_id: A["工具器具備品"], acquisition_date: `${Y}-04-10`, acquisition_cost: 300000, useful_life: 4, method: "straight_line", business_ratio: 80 });
check("asset created", asset.id > 0);

// 銀行CSV
const ba = await call("POST", "/bank-accounts", { name: "テスト銀行", kind: "bank" });
const csv = ["取引日,摘要,お引出し,お預入れ,残高", `${Y}/05/01,ﾌﾘｺﾐ ｶ)ABC,,3300000,4000000`, `${Y}/05/02,ｱﾏｿﾞﾝ ﾌﾞﾝﾎﾞｳｸﾞ,2200,,3997800`, `${Y}/05/03,東京電力 電気代,6000,,3991800`, `${Y}/05/04,ナゾノシハライ,1000,,3990800`].join("\n");
const pv = await call("POST", `/bank-accounts/${ba.id}/csv/preview`, { text: csv });
check("csv detected", pv.mapping && pv.count === 4, pv);
const imp = await call("POST", `/bank-accounts/${ba.id}/csv/import`, { text: csv, mapping: pv.mapping });
check("csv imported 4", imp.imported === 4, imp);
const imp2 = await call("POST", `/bank-accounts/${ba.id}/csv/import`, { text: csv, mapping: pv.mapping });
check("csv dedup", imp2.imported === 0 && imp2.duplicates === 4, imp2);
let txs = await call("GET", "/bank-transactions?status=unprocessed");
const elec = txs.find((t) => t.description.includes("東京電力"));
check("learned suggestion", elec.suggestion.source === "learned" && elec.suggestion.account_id === A["水道光熱費"], elec.suggestion);
const abc = txs.find((t) => t.amount > 0);
await call("POST", `/bank-transactions/${abc.id}/journal`, { account_id: A["売掛金"], tax_category: "out" });
const auto = await call("POST", "/bank-transactions/auto", { min_confidence: 0.8 });
check("auto journal", auto.journaled >= 1, auto);
txs = await call("GET", "/bank-transactions?status=unprocessed");
check("low confidence left", txs.length >= 1 && txs.some((t) => t.description.includes("ナゾノ")), txs.map((t) => t.description));
const nazo = txs.find((t) => t.description.includes("ナゾノ"));
await call("POST", `/bank-transactions/${nazo.id}/status`, { status: "ignored" });
const ai = await call("POST", `/bank-transactions/${nazo.id}/ai-suggest`, undefined, true);
console.log("     ai-suggest (local, no AI):", ai.status, ai.data?.source);

// 領収書
const fd = new FormData();
fd.append("file", new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: "application/pdf" }), "receipt.pdf");
fd.append("issued_date", `${Y}-04-10`);
fd.append("amount", "300000");
fd.append("partner", "家電量販店");
const up = await call("POST", "/receipts", fd);
check("receipt uploaded", up.ids?.length === 1, up);
const cands = await call("GET", `/receipts/${up.ids[0]}/candidates`);
check("receipt candidates", cands.length >= 1 && cands[0].description === "ノートPC", cands);
await call("PUT", `/receipts/${up.ids[0]}`, { issued_date: `${Y}-04-10`, amount: 300000, partner: "家電量販店", doc_type: "receipt", journal_id: cands[0].id });
const file = await call("GET", `/receipts/${up.ids[0]}/file`, undefined, true);
check("receipt file served", file.status === 200 && file.headers.get("content-type") === "application/pdf");
const badType = new FormData();
badType.append("file", new Blob(["<svg/>"], { type: "image/svg+xml" }), "x.svg");
check("svg rejected", (await call("POST", "/receipts", badType, true)).status === 415);
const link = await call("POST", "/receipts/link", { url: "https://drive.google.com/file/d/abc/view", issued_date: `${Y}-05-02`, amount: 2200 });
check("external link", link.id > 0);
check("external non-https rejected", (await call("POST", "/receipts/link", { url: "javascript:alert(1)" }, true)).status === 400);
const search = await call("GET", `/receipts?min=1000&max=5000`);
check("receipt search by amount", search.length === 1 && search[0].amount === 2200, search);

// 決算
const cl = await call("GET", `/closing/${Y}`);
check("closing preview", cl.depreciation.length === 1 && cl.apportion.length === 1 && cl.apportion[0].private === 840000, cl);
await call("POST", `/closing/${Y}/depreciation`);
await call("POST", `/closing/${Y}/depreciation`); // idempotent
await call("POST", `/closing/${Y}/apportion`);
await call("POST", `/closing/${Y}/inventory`, { amount: 0 });
const dep = await call("GET", `/journals?source=depreciation&from=${Y}-01-01&to=${Y}-12-31`);
check("depreciation idempotent", dep.total === 1 && dep.items[0].lines.find((l) => l.account_id === A["減価償却費"]).amount === 45000, dep);

const st = await call("GET", `/tax/${Y}/statement`);
console.log("     PL:", { sales: st.pl.sales, exp: st.pl.total_expenses, before: st.pl.income_before_deduction, blue: st.pl.blue_deduction, income: st.pl.income });
check("BS balanced", st.bs.total_assets.closing === st.bs.total_liabilities.closing, st.bs);
check("rent after apportion", st.pl.expenses.find((e) => e.label === "地代家賃").amount === 360000);
await call("PUT", `/tax/${Y}/inputs`, { social_insurance: 300000, withholding: 100000 });
const it = await call("GET", `/tax/${Y}/income`);
console.log("     income tax:", it.result);
const ct = await call("GET", `/tax/${Y}/consumption`);
console.log("     consumption:", ct.result);
const tb = await call("GET", `/reports/trial-balance?from=${Y}-01-01&to=${Y}-12-31`);
const dsum = tb.reduce((s, r) => s + r.debit, 0), csum = tb.reduce((s, r) => s + r.credit, 0);
check("trial balance D=C", dsum === csum, { dsum, csum });
const tbMid = await call("GET", `/reports/trial-balance?from=${Y}-04-01&to=${Y}-04-30`);
check("mid-period opening", tbMid.find((r) => r.name === "普通預金").opening === 1000000 - 1200000 - 3500 - 1500 + 0, tbMid.find((r) => r.name === "普通預金"));
const led = await call("GET", `/reports/ledger?account_id=${A["普通預金"]}&year=${Y}`);
check("ledger closing", led.rows.at(-1).balance === led.closing, led);
const dash = await call("GET", `/reports/dashboard?year=${Y}`);
check("dashboard", dash.sales === 3300000, dash);

const cf = await call("POST", `/closing/${Y}/carry-forward`);
check("carry forward", cf.ok, cf);
const op = await call("GET", `/opening/${Y + 1}`);
console.log("     next opening:", op.map((o) => [accounts.find((a) => a.id === o.account_id).name, o.amount]));

const csvOut = await call("GET", `/export/journals.csv?year=${Y}`, undefined, true);
check("csv export", csvOut.status === 200 && csvOut.data.includes("伝票番号"));
const bk = await call("GET", "/export/backup.json", undefined, true);
check("backup", bk.status === 200 && bk.data.tables.journals.length > 0);

await call("DELETE", `/journals/${j1.id}`);
const log = await call("GET", `/audit-log?entity=journal&entity_id=${j1.id}`);
check("audit log create+delete", log.length === 2 && log[0].action === "delete", log);

// 学習ルール
const rules = await call("GET", "/rules");
check("learned rules exist", rules.some((r) => r.kind === "learned"), rules.length);
console.log(fails ? `\n${fails} FAILURES` : "\nALL OK");
process.exit(fails ? 1 : 0);
