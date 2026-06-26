/**
 * 動的 sitemap.xml 生成
 * - 静的ページ + microCMS の動的記事をすべて含む
 */
import { fetchNewsList, fetchColumnsList, fetchResultsList } from '../lib/microcms';

export const prerender = false;

const SITE = 'https://funsportnexus.org';

const staticPages = [
  { path: '/',                  priority: '1.0', changefreq: 'weekly' },
  { path: '/news/',             priority: '0.9', changefreq: 'weekly' },
  { path: '/columns/',          priority: '0.9', changefreq: 'weekly' },
  { path: '/results/',          priority: '0.9', changefreq: 'monthly' },
  { path: '/events/',           priority: '0.9', changefreq: 'weekly' },
  { path: '/business/',         priority: '0.8', changefreq: 'monthly' },
  { path: '/contact/',          priority: '0.7', changefreq: 'yearly' },
  { path: '/202612orisen/',          priority: '0.95', changefreq: 'weekly' },
  { path: '/202612orisen/programs/', priority: '0.9', changefreq: 'weekly' },
  { path: '/202612orisen/access/',   priority: '0.8', changefreq: 'monthly' },
  { path: '/202612orisen/apply/',    priority: '0.9', changefreq: 'weekly' },
];

const toISO = (date) => {
  try {
    return new Date(date).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

export async function GET({ locals }) {
  const urls = [];

  // 静的ページ
  const now = new Date().toISOString();
  for (const p of staticPages) {
    urls.push({
      loc: `${SITE}${p.path}`,
      lastmod: now,
      changefreq: p.changefreq,
      priority: p.priority,
    });
  }

  // 動的ページ（microCMS）
  try {
    const news = await fetchNewsList(locals, { limit: 100 });
    for (const item of news?.contents ?? []) {
      urls.push({
        loc: `${SITE}/news/${item.id}/`,
        lastmod: toISO(item.updatedAt || item.publishedAt),
        changefreq: 'monthly',
        priority: '0.7',
      });
    }
  } catch {}

  try {
    const cols = await fetchColumnsList(locals, { limit: 100 });
    for (const item of cols?.contents ?? []) {
      urls.push({
        loc: `${SITE}/columns/${item.id}/`,
        lastmod: toISO(item.updatedAt || item.publishedAt),
        changefreq: 'monthly',
        priority: '0.7',
      });
    }
  } catch {}

  try {
    const rs = await fetchResultsList(locals, { limit: 100 });
    for (const item of rs?.contents ?? []) {
      urls.push({
        loc: `${SITE}/results/${item.id}/`,
        lastmod: toISO(item.updatedAt || item.publishedAt),
        changefreq: 'monthly',
        priority: '0.7',
      });
    }
  } catch {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
