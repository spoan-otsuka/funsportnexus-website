import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: 'https://5faa65aa0e6a9858b5f399f75287aab5@o4511691594203136.ingest.us.sentry.io/4511743566217216',

  tracesSampleRate: 0.1,

  enabled: import.meta.env.PROD,

  environment: import.meta.env.PROD ? 'production' : 'development',
});
