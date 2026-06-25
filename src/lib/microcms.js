/**
 * microCMS クライアント
 * - Cloudflare Workers ランタイムで動作
 * - env.MICROCMS_SERVICE_DOMAIN / env.MICROCMS_API_KEY を使う
 */
import { createClient } from 'microcms-js-sdk';

/**
 * リクエストごとに microCMS クライアントを生成。
 * locals.runtime.env から環境変数を取得する。
 *
 * @param {Object} locals  Astro.locals
 * @returns {Object}  microcms-js-sdk のクライアント
 */
export function getMicroCmsClient(locals) {
  const env = locals?.runtime?.env ?? {};
  const serviceDomain = env.MICROCMS_SERVICE_DOMAIN || 'funsportnexus';
  const apiKey = env.MICROCMS_API_KEY;

  if (!apiKey) {
    throw new Error('MICROCMS_API_KEY is not configured');
  }

  return createClient({
    serviceDomain,
    apiKey,
  });
}

/**
 * お知らせ一覧を取得
 * @param {Object} locals
 * @param {Object} [queries]  filters / orders / limit / offset 等
 */
export async function fetchNewsList(locals, queries = {}) {
  const client = getMicroCmsClient(locals);
  return client.get({
    endpoint: 'news',
    queries: {
      orders: '-publishedAt',
      limit: 20,
      ...queries,
    },
  });
}

/**
 * お知らせ詳細を取得
 * @param {Object} locals
 * @param {string} contentId
 */
export async function fetchNewsDetail(locals, contentId) {
  const client = getMicroCmsClient(locals);
  return client.getListDetail({
    endpoint: 'news',
    contentId,
  });
}
