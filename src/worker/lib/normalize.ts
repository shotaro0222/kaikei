/** 全角/半角・大小文字・空白のゆれを吸収した比較用文字列 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)) // ひらがな→カタカナ
    .replace(/[\s　]+/g, " ")
    .trim();
}

/**
 * 学習ルール用のキー。銀行明細の摘要に含まれる日付・番号等を除去し、
 * 同じ取引先からの明細が同じキーになるようにする。
 */
export function learningKey(s: string): string {
  return normalizeText(s)
    .replace(/\d{1,4}[\/\-.]\d{1,2}([\/\-.]\d{1,4})?/g, " ")
    .replace(/[0-9０-９]{3,}/g, " ")
    .replace(/[()（）「」\[\]*＊]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
