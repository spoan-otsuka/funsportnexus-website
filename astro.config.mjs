import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sentry from '@sentry/astro';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  site: 'https://funsportnexus.org',
  // 旧 WordPress URL からのリダイレクト
  redirects: {
    '/grant.html': '/business/',
  },
  integrations: [
    sentry({
      sourceMapsUploadOptions: { enabled: false },
    }),
  ],
});
