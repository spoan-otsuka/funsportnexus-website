/**
 * microCMS 画像 URL ヘルパー
 * 画像APIは ?w=XXX で自動リサイズ、?h=XXX&fit=crop でクロップ
 */

const DEFAULT_WIDTHS = [600, 900, 1200, 1600];

/**
 * srcset 文字列を生成（リサイズのみ・元アスペクト比維持）
 */
export function srcset(url, widths = DEFAULT_WIDTHS) {
  if (!url) return '';
  return widths.map(w => `${url}?w=${w} ${w}w`).join(', ');
}

/**
 * srcset 文字列を生成（クロップ付き・アスペクト比指定）
 * @param {string} url   microCMS 画像URL
 * @param {string} ratio 例: '5/3', '16/9', '1/1'
 * @param {number[]} widths
 */
export function srcsetCrop(url, ratio = '5/3', widths = DEFAULT_WIDTHS) {
  if (!url) return '';
  const [aw, ah] = ratio.split('/').map(Number);
  return widths.map(w => {
    const h = Math.round((w * ah) / aw);
    return `${url}?w=${w}&h=${h}&fit=crop ${w}w`;
  }).join(', ');
}

/**
 * メインの src URL を生成（リサイズ）
 */
export function src(url, width = 1200) {
  if (!url) return '';
  return `${url}?w=${width}`;
}

/**
 * メインの src URL を生成（クロップ付き）
 */
export function srcCrop(url, width = 1200, ratio = '5/3') {
  if (!url) return '';
  const [aw, ah] = ratio.split('/').map(Number);
  const h = Math.round((width * ah) / aw);
  return `${url}?w=${width}&h=${h}&fit=crop`;
}
