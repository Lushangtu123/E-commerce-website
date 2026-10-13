// Runs in the browser before the app becomes interactive (Next.js instrumentation-client convention).
// Only a build with NEXT_PUBLIC_SENTRY_DSN downloads the Sentry SDK; without it this branch is compiled away.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  import('@/lib/error-reporting')
    .then(({ initClientErrorReporting }) => initClientErrorReporting())
    // Monitoring must never keep the store from loading.
    .catch(() => {});
}
