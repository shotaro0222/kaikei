import type { Direction, TaxCategory } from "./types";
import { normalizeText } from "./normalize";

/**
 * 組込みの自動仕訳辞書。キーワード（部分一致）→ 勘定科目名。
 * ユーザー登録ルール・学習ルールが優先され、ここに無いものは AI 推定にフォールバックする。
 */
export interface DictEntry {
  account: string;
  direction: Direction;
  tax?: TaxCategory;
  keywords: string[];
}

export const DICTIONARY: DictEntry[] = [
  // ---- 収入 ----
  { account: "売上高", direction: "income", keywords: ["売上", "報酬", "請負", "業務委託料", "制作費", "デザイン料", "コンサル", "原稿料", "講演料", "入金 売掛", "STRIPE", "SQUARE", "PAYPAL", "AIRペイ", "楽天ペイ", "STORES", "BASE", "ココナラ", "クラウドワークス", "ランサーズ", "NOTE", "YOUTUBE", "ADSENSE"] },
  { account: "雑収入", direction: "income", tax: "out", keywords: ["利息", "受取利息", "還付", "ポイント", "キャッシュバック", "助成金", "補助金", "給付金", "雑収入"] },

  // ---- 支出 ----
  { account: "仕入高", direction: "expense", keywords: ["仕入", "商品購入", "材料", "原材料", "卸"] },
  { account: "租税公課", direction: "expense", tax: "out", keywords: ["印紙", "収入印紙", "固定資産税", "自動車税", "軽自動車税", "事業税", "登録免許税", "不動産取得税", "納税", "税務署", "都税", "県税", "市税"] },
  { account: "荷造運賃", direction: "expense", keywords: ["ヤマト", "宅急便", "佐川", "日本郵便", "ゆうパック", "ゆうパケット", "レターパック", "クリックポスト", "送料", "配送", "運賃", "梱包", "段ボール"] },
  { account: "水道光熱費", direction: "expense", keywords: ["電気", "電力", "ガス", "水道", "東京電力", "関西電力", "中部電力", "東京ガス", "大阪ガス", "でんき", "光熱"] },
  { account: "旅費交通費", direction: "expense", keywords: ["電車", "バス", "タクシー", "新幹線", "JR", "地下鉄", "メトロ", "SUICA", "PASMO", "ICOCA", "交通費", "航空", "ANA", "JAL", "PEACH", "飛行機", "ホテル", "宿泊", "旅館", "東横イン", "APAホテル", "高速", "ETC", "駐車", "パーキング", "UBER", "GO タクシー", "定期券", "出張"] },
  { account: "通信費", direction: "expense", keywords: ["携帯", "スマホ", "電話", "NTT", "DOCOMO", "ドコモ", "AU", "KDDI", "SOFTBANK", "ソフトバンク", "楽天モバイル", "AHAMO", "POVO", "LINEMO", "UQ", "Y!MOBILE", "ワイモバイル", "インターネット", "プロバイダ", "光回線", "WIFI", "WI-FI", "サーバー", "サーバ", "ドメイン", "お名前.COM", "さくらインターネット", "XSERVER", "エックスサーバー", "AWS", "AMAZON WEB SERVICES", "GOOGLE CLOUD", "CLOUDFLARE", "VERCEL", "切手", "郵便", "はがき"] },
  { account: "広告宣伝費", direction: "expense", keywords: ["広告", "宣伝", "GOOGLE ADS", "グーグル広告", "META ADS", "FACEBOOK広告", "INSTAGRAM広告", "X広告", "チラシ", "名刺", "ポスティング", "販促", "ノベルティ", "求人"] },
  { account: "接待交際費", direction: "expense", keywords: ["接待", "会食", "懇親会", "飲み会", "手土産", "お土産", "贈答", "お中元", "お歳暮", "ご祝儀", "香典", "慶弔", "ゴルフ"] },
  { account: "損害保険料", direction: "expense", tax: "exempt", keywords: ["火災保険", "損害保険", "自動車保険", "任意保険", "自賠責", "賠償責任保険", "損保"] },
  { account: "修繕費", direction: "expense", keywords: ["修理", "修繕", "メンテナンス", "点検", "車検", "交換工事"] },
  { account: "消耗品費", direction: "expense", keywords: ["文房具", "文具", "事務用品", "コピー用紙", "インク", "トナー", "USB", "ケーブル", "マウス", "キーボード", "ヘッドセット", "電池", "消耗品", "100均", "ダイソー", "セリア", "キャンドゥ", "ASKUL", "アスクル", "LOHACO", "モノタロウ", "ヨドバシ", "ビックカメラ", "ヤマダ電機", "ケーズデンキ", "ニトリ", "IKEA", "ホームセンター", "カインズ", "コーナン", "AMAZON", "アマゾン", "ソフトウェア", "サブスク"] },
  { account: "福利厚生費", direction: "expense", keywords: ["福利厚生", "健康診断", "人間ドック", "社員旅行", "従業員 飲み物"] },
  { account: "給料賃金", direction: "expense", tax: "out", keywords: ["給料", "給与", "賃金", "アルバイト代", "パート代", "賞与"] },
  { account: "外注工賃", direction: "expense", keywords: ["外注", "業務委託", "下請", "クラウドソーシング", "デザイン依頼"] },
  { account: "利子割引料", direction: "expense", tax: "exempt", keywords: ["支払利息", "借入利息", "ローン利息", "利子", "割引料"] },
  { account: "地代家賃", direction: "expense", keywords: ["家賃", "賃料", "地代", "事務所賃", "コワーキング", "シェアオフィス", "レンタルオフィス", "バーチャルオフィス", "月極", "管理費", "共益費", "トランクルーム"] },
  { account: "支払手数料", direction: "expense", keywords: ["振込手数料", "手数料", "決済手数料", "STRIPE FEE", "PAYPAL手数料", "税理士", "司法書士", "行政書士", "社労士", "仲介手数料", "ATM"] },
  { account: "会議費", direction: "expense", keywords: ["会議", "打ち合わせ", "打合せ", "ミーティング", "カフェ", "スターバックス", "STARBUCKS", "ドトール", "タリーズ", "コメダ", "喫茶", "貸会議室"] },
  { account: "新聞図書費", direction: "expense", keywords: ["書籍", "本", "雑誌", "新聞", "KINDLE", "日経", "電子書籍", "紀伊國屋", "丸善", "ジュンク堂", "TSUTAYA", "図書"] },
  { account: "研修費", direction: "expense", keywords: ["研修", "セミナー", "講座", "勉強会", "UDEMY", "スクール", "受講料", "資格"] },
  { account: "車両費", direction: "expense", keywords: ["ガソリン", "給油", "ENEOS", "出光", "コスモ石油", "洗車", "オイル交換", "タイヤ"] },
  { account: "諸会費", direction: "expense", tax: "out", keywords: ["年会費", "会費", "商工会", "組合費", "協会費"] },
  { account: "雑費", direction: "expense", keywords: ["雑費", "クリーニング"] },
  { account: "事業主貸", direction: "expense", tax: "out", keywords: ["国民健康保険", "国民年金", "所得税", "住民税", "生活費", "私用", "プライベート", "ふるさと納税", "生命保険", "医療費"] },
];

export interface DictMatch {
  account: string;
  direction: Direction;
  tax?: TaxCategory;
  keyword: string;
}

const NORMALIZED: Array<DictEntry & { norm: string[] }> = DICTIONARY.map((e) => ({
  ...e,
  norm: e.keywords.map((k) => normalizeText(k)),
}));

/** 最長一致したキーワードの辞書項目を返す */
export function matchDictionary(text: string, direction: Direction): DictMatch | null {
  const t = normalizeText(text);
  let best: DictMatch | null = null;
  let bestLen = 0;
  for (const e of NORMALIZED) {
    if (e.direction !== direction) continue;
    e.norm.forEach((k, i) => {
      if (k.length > bestLen && t.includes(k)) {
        best = { account: e.account, direction: e.direction, tax: e.tax, keyword: e.keywords[i] };
        bestLen = k.length;
      }
    });
  }
  return best;
}
