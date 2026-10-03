import { describe, expect, it } from "vitest";
import { applyMapping, dedupKeys, detectMapping, parseAmount, parseCsv, parseDate } from "../src/worker/lib/csv";

describe("parseCsv", () => {
  it("クォート・改行・BOM", () => {
    const rows = parseCsv('﻿日付,摘要,金額\r\n2025/1/5,"ABC, Inc.",1000\n2025/1/6,"改行\nあり","1,200"\n');
    expect(rows).toEqual([
      ["日付", "摘要", "金額"],
      ["2025/1/5", "ABC, Inc.", "1000"],
      ["2025/1/6", "改行\nあり", "1,200"],
    ]);
  });
});

describe("parseDate / parseAmount", () => {
  it("さまざまな日付形式", () => {
    expect(parseDate("2025/1/5")).toBe("2025-01-05");
    expect(parseDate("2025年01月05日")).toBe("2025-01-05");
    expect(parseDate("20250105")).toBe("2025-01-05");
    expect(parseDate("R7.1.5")).toBe("2025-01-05");
    expect(parseDate("令和7年1月5日")).toBe("2025-01-05");
    expect(parseDate("2025/02/30")).toBeNull();
    expect(parseDate("合計")).toBeNull();
  });
  it("さまざまな金額形式", () => {
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("￥１，２３４円")).toBe(1234);
    expect(parseAmount("△500")).toBe(-500);
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("detectMapping + applyMapping", () => {
  it("入金・出金が別列の銀行CSV", () => {
    const rows = parseCsv(["口座: 普通 1234567", "取引日,摘要,お引出し,お預入れ,残高", "2025/01/05,東京電力,8800,,100000", "2025/01/10,振込 カ)ABC,,330000,430000"].join("\n"));
    const m = detectMapping(rows)!;
    expect(m.header_row).toBe(1);
    const r = applyMapping(rows, m);
    expect(r.transactions).toEqual([
      { row: 3, date: "2025-01-05", description: "東京電力", amount: -8800, balance: 100000 },
      { row: 4, date: "2025-01-10", description: "振込 カ)ABC", amount: 330000, balance: 430000 },
    ]);
  });

  it("符号付き1列（カード明細は利用額を出金として反転）", () => {
    const rows = parseCsv(["利用日,利用店名,利用金額", "2025/02/01,AMAZON.CO.JP,3980", "2025/02/03,返品 AMAZON,-500"].join("\n"));
    const m = detectMapping(rows, true)!;
    expect(m.invert).toBe(true);
    const r = applyMapping(rows, m);
    expect(r.transactions.map((t) => t.amount)).toEqual([-3980, 500]);
  });

  it("重複キーは同日同額の取引を区別する", () => {
    const tx = { date: "2025-01-01", amount: -100, description: "A", balance: null };
    const keys = dedupKeys(1, [tx, tx, { ...tx, external_id: "x1" }]);
    expect(new Set(keys).size).toBe(3);
    expect(dedupKeys(1, [tx, tx])).toEqual(keys.slice(0, 2));
  });
});
