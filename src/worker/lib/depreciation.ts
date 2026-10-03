export interface FixedAsset {
  id: number;
  name: string;
  account_id: number;
  quantity: number;
  acquisition_date: string;
  service_date: string | null;
  acquisition_cost: number;
  useful_life: number;
  method: "straight_line" | "lump_sum" | "immediate";
  business_ratio: number;
  disposal_date: string | null;
  memo: string | null;
}

export interface DepreciationResult {
  asset_id: number;
  year: number;
  rate: number; // 償却率（一括償却は 1/3、即時は 1）
  months: number; // 本年中の償却期間（月数）
  opening_book: number; // 期首（または取得時）の未償却残高
  depreciation: number; // 本年分の普通償却費
  business_amount: number; // 必要経費算入額（事業専用割合を乗じたもの）
  closing_book: number; // 期末の未償却残高
  accumulated: number; // 期末までの償却累計額
}

/** 定額法の償却率（平成19年4月1日以後取得）。耐用年数省令別表第八と一致する */
export function straightLineRate(life: number): number {
  if (life <= 1) return 1;
  return Math.ceil(1000 / life) / 1000;
}

function ym(date: string): { y: number; m: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
}

/** year 年分の償却費を計算する（前年までは同じ方法で償却済みとみなして累積計算） */
export function computeDepreciation(a: FixedAsset, year: number): DepreciationResult {
  const start = ym(a.service_date || a.acquisition_date);
  const disposal = a.disposal_date ? ym(a.disposal_date) : null;
  const cost = a.acquisition_cost;
  const base: DepreciationResult = {
    asset_id: a.id,
    year,
    rate: 0,
    months: 0,
    opening_book: cost,
    depreciation: 0,
    business_amount: 0,
    closing_book: cost,
    accumulated: 0,
  };
  if (year < start.y) return base;

  let book = cost;
  let result = base;
  for (let y = start.y; y <= year; y++) {
    const opening = book;
    let dep = 0;
    let months = 0;
    let rate = 0;
    const disposedBefore = disposal && disposal.y < y;
    if (!disposedBefore && book > 0) {
      if (a.method === "immediate") {
        rate = 1;
        months = y === start.y ? 12 - start.m + 1 : 0;
        dep = y === start.y ? book : 0;
      } else if (a.method === "lump_sum") {
        // 一括償却資産: 月数に関係なく 3 年で均等償却。除却しても継続
        rate = 1 / 3;
        const idx = y - start.y;
        months = idx < 3 ? 12 : 0;
        dep = idx < 2 ? Math.floor(cost / 3) : idx === 2 ? book : 0;
      } else {
        rate = straightLineRate(a.useful_life);
        months = y === start.y ? 12 - start.m + 1 : 12;
        if (disposal && disposal.y === y) months = Math.min(months, disposal.m - (y === start.y ? start.m - 1 : 0));
        dep = Math.ceil((cost * rate * months) / 12);
        dep = Math.min(dep, book - 1); // 備忘価額 1 円を残す
        if (dep < 0) dep = 0;
      }
    }
    book = opening - dep;
    if (disposal && disposal.y === y && a.method !== "lump_sum") book = 0; // 除却・売却で台帳から外す
    result = {
      asset_id: a.id,
      year: y,
      rate,
      months,
      opening_book: opening,
      depreciation: dep,
      business_amount: Math.round((dep * a.business_ratio) / 100),
      closing_book: book,
      accumulated: cost - (opening - dep),
    };
  }
  return result;
}
