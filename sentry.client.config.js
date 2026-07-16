import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: 'https://5faa65aa0e6a9858b5f399f75287aab5@o4511691594203136.ingest.us.sentry.io/4511743566217216',

  // クォータ節約：本番でも 100% トレースは取らない
  tracesSampleRate: 0.1,

  // セッションリプレイは無効（Free tier のイベント枠節約）
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // 本番のみ送信、dev では送らない
  enabled: import.meta.env.PROD,

  environment: import.meta.env.PROD ? 'production' : 'development',
});
