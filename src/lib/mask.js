/**
 * 個人情報マスキング ユーティリティ
 *
 * 用途：Slack 通知などの社内チャンネルでの個人情報露出を最小化
 * 方針：姓は残し、名は伏せる（必要に応じて管理画面で全文を確認できるため）
 */

/**
 * 氏名をマスキング
 * - 「大塚光一」→ 「大塚 ◯」
 * - 「田中 太郎」→ 「田中 ◯」（スペース含む）
 * - 「山田 はな子」→ 「山田 ◯」
 * - 「Tanaka Pablo」→ 「Tanaka ◯」（半角スペース区切り）
 * - 1文字のみ → 「◯」
 * - 空文字 → 「（無記入）」
 */
export function maskName(name) {
  if (!name) return '（無記入）';
  const s = String(name).trim();
  if (s.length === 0) return '（無記入）';
  if (s.length === 1) return '◯';

  // スペース区切り（全角/半角）の場合：最初のセグメントだけ残す
  const m = s.match(/^([^\s　]+)[\s　]+/);
  if (m) return `${m[1]} ◯`;

  // スペースなし日本語名：先頭2文字（姓と想定）を残す
  if (/^[一-龥ぁ-んァ-ンー]+$/.test(s)) {
    if (s.length <= 2) return `${s.slice(0, 1)} ◯`;
    return `${s.slice(0, 2)} ◯`;
  }

  // ローマ字など：先頭3文字
  return `${s.slice(0, 3)}…`;
}

/**
 * メールアドレスをマスキング
 * - foo@example.com → f**@example.com
 * - 短いと a@***.com
 */
export function maskEmail(email) {
  if (!email) return '（無記入）';
  const s = String(email).trim();
  const at = s.indexOf('@');
  if (at < 0) return '（不正）';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const ml = local.length > 1 ? local[0] + '*'.repeat(Math.min(local.length - 1, 3)) : local;
  const dotIdx = domain.indexOf('.');
  if (dotIdx < 0) return `${ml}@***`;
  const tld = domain.slice(dotIdx);
  return `${ml}@***${tld}`;
}

/**
 * 電話番号をマスキング
 * - 09012345678 → 090****5678
 * - 03-1234-5678 → 03-****-5678
 */
export function maskTel(tel) {
  if (!tel) return '（無記入）';
  const s = String(tel).trim().replace(/[\s-‐ー]/g, '');
  if (s.length < 4) return '*'.repeat(s.length);
  const head = s.slice(0, 3);
  const tail = s.slice(-4);
  return `${head}${'*'.repeat(Math.max(0, s.length - 7))}${tail}`;
}
