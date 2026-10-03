/**
 * 銀行・クレジットカードの CSV 明細の解析。
 * 各行のヘッダ名から列を自動判定し、判定できない場合は画面で列割当を指定できる。
 * 文字コード（Shift_JIS 等）はブラウザ側で UTF-8 に変換してから送信する。
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === "," || c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export interface CsvMapping {
  header_row: number; // ヘッダ行の index（-1 ならヘッダなし）
  date: number;
  description: number[]; // 複数列を連結
  withdrawal?: number | null; // 出金列
  deposit?: number | null; // 入金列
  amount?: number | null; // 符号付き金額列（入出金を1列で表す場合）
  invert?: boolean; // amount 列の符号を反転（カード明細: 利用額がプラス）
  balance?: number | null;
}

const H = {
  date: ["取引日", "お取引日", "取扱日", "日付", "年月日", "利用日", "ご利用日", "ご利用年月日", "利用年月日", "お取扱日", "取引年月日", "勘定日", "日時", "DATE"],
  description: ["摘要", "お取引内容", "取引内容", "内容", "取引名", "利用店名", "ご利用店名", "ご利用先", "利用先", "ご利用店名・商品名", "店名", "取引先", "備考", "メモ", "詳細", "DESCRIPTION"],
  withdrawal: ["出金", "出金金額", "お引出し", "お支払金額", "支払金額", "引出金額", "出金額", "お引出", "支出"],
  deposit: ["入金", "入金金額", "お預入れ", "お預入金額", "預入金額", "入金額", "お預入", "収入"],
  amount: ["入出金", "入出金(円)", "入出金金額", "金額", "取引金額", "利用金額", "ご利用金額", "ご利用額", "利用額", "請求金額", "AMOUNT"],
  balance: ["残高", "差引残高", "現在高", "取引後残高", "残高(円)", "BALANCE"],
};

function norm(h: string): string {
  return h.normalize("NFKC").replace(/\s|（|）|\(|\)|円/g, "").toUpperCase();
}

function findCol(headers: string[], names: string[], exclude: Set<number>): number | null {
  const hs = headers.map(norm);
  const ns = names.map(norm);
  // 完全一致 → 部分一致の順
  for (const n of ns) {
    const i = hs.findIndex((h, idx) => !exclude.has(idx) && h === n);
    if (i >= 0) return i;
  }
  for (const n of ns) {
    const i = hs.findIndex((h, idx) => !exclude.has(idx) && h.includes(n));
    if (i >= 0) return i;
  }
  return null;
}

/** ヘッダ行を探して列割当を推定する */
export function detectMapping(rows: string[][], isCard = false): CsvMapping | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const headers = rows[r];
    const used = new Set<number>();
    const date = findCol(headers, H.date, used);
    if (date === null) continue;
    used.add(date);
    const withdrawal = findCol(headers, H.withdrawal, used);
    if (withdrawal !== null) used.add(withdrawal);
    const deposit = findCol(headers, H.deposit, used);
    if (deposit !== null) used.add(deposit);
    const balance = findCol(headers, H.balance, used);
    if (balance !== null) used.add(balance);
    let amount: number | null = null;
    if (withdrawal === null && deposit === null) {
      amount = findCol(headers, H.amount, used);
      if (amount !== null) used.add(amount);
    }
    const desc = findCol(headers, H.description, used);
    if (withdrawal === null && deposit === null && amount === null) continue;
    return {
      header_row: r,
      date,
      description: desc !== null ? [desc] : [],
      withdrawal,
      deposit,
      amount,
      invert: amount !== null && isCard,
      balance,
    };
  }
  return null;
}

/** 金額文字列を整数に。カンマ・円記号・全角・△/▲（マイナス）・括弧を処理 */
export function parseAmount(s: string | undefined): number | null {
  if (s == null) return null;
  let t = s.normalize("NFKC").trim();
  if (!t) return null;
  let neg = false;
  if (/^[△▲-]/.test(t) || /^\(.*\)$/.test(t)) neg = true;
  t = t.replace(/[,，円¥\\\s△▲()+]/g, "").replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Math.round(Number(t));
  return neg ? -v : v;
}

const ERA: Record<string, number> = { R: 2018, 令和: 2018, H: 1988, 平成: 1988 };

/** 日付文字列を YYYY-MM-DD に。和暦（R7.1.5 / 令和7年1月5日）・8桁数字にも対応 */
export function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.normalize("NFKC").trim();
  let y: number, m: number, d: number;
  let mm = t.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (mm) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if ((mm = t.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [Number(mm[1]), Number(mm[2]), Number(mm[3])];
  else if ((mm = t.match(/^(R|H|令和|平成)\s*(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/i))) {
    const era = ERA[mm[1].toUpperCase()] ?? ERA[mm[1]];
    y = era + (mm[2] === "元" ? 1 : Number(mm[2]));
    m = Number(mm[3]);
    d = Number(mm[4]);
  } else if ((mm = t.match(/^(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/))) {
    [y, m, d] = [2000 + Number(mm[1]), Number(mm[2]), Number(mm[3])];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

export interface ParsedTransaction {
  row: number;
  date: string;
  description: string;
  amount: number; // 入金 +, 出金 -
  balance: number | null;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: Array<{ row: number; message: string }>;
}

export function applyMapping(rows: string[][], m: CsvMapping): ParseResult {
  const transactions: ParsedTransaction[] = [];
  const errors: ParseResult["errors"] = [];
  for (let i = m.header_row + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseDate(r[m.date]);
    if (!date) {
      // 合計行・空行などは日付が無いのでスキップ（エラー扱いしない）
      if ((r[m.date] ?? "").trim() !== "" && !/合計|計|TOTAL/i.test(r.join(""))) errors.push({ row: i + 1, message: `日付を解釈できません: ${r[m.date]}` });
      continue;
    }
    let amount: number | null = null;
    if (m.amount != null) {
      const a = parseAmount(r[m.amount]);
      if (a !== null) amount = m.invert ? -a : a;
    } else {
      const w = m.withdrawal != null ? parseAmount(r[m.withdrawal]) : null;
      const dep = m.deposit != null ? parseAmount(r[m.deposit]) : null;
      if (w || dep) amount = (dep ?? 0) - (w ?? 0);
    }
    if (amount === null || amount === 0) {
      errors.push({ row: i + 1, message: "金額を解釈できません" });
      continue;
    }
    const description = m.description
      .map((c) => (r[c] ?? "").trim())
      .filter(Boolean)
      .join(" ");
    transactions.push({
      row: i + 1,
      date,
      description: description || "(摘要なし)",
      amount,
      balance: m.balance != null ? parseAmount(r[m.balance]) : null,
    });
  }
  return { transactions, errors };
}

/**
 * 重複取込防止キー。同日・同額・同摘要の取引が複数ある場合に備え、出現回数を含める。
 */
export function dedupKeys(bankAccountId: number, txs: Array<{ date: string; amount: number; description: string; balance: number | null; external_id?: string | null }>): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    if (t.external_id) return `${bankAccountId}|ext|${t.external_id}`;
    const base = `${bankAccountId}|${t.date}|${t.amount}|${t.description.normalize("NFKC").replace(/\s+/g, "")}|${t.balance ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}
