import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  site: 'https://funsportnexus.org',
  // ハイブリッドモード：基本は静的、申込APIだけサーバーサイド
});
