/**
 * Optional browser error reporting. This module holds no Sentry code: with NEXT_PUBLIC_SENTRY_DSN set at
 * build time it loads lib/sentry-browser.ts on demand, so visitors of a build without a DSN download nothing.
 * Errors raised while the SDK loads are queued and reported once it has started.
 */
type SentryModule = typeof import('@/lib/sentry-browser');

const MAX_PENDING = 10;
let sentry: SentryModule | null = null;
let loading: Promise<void> | null = null;
const pending: Error[] = [];

function queue(error: unknown): void {
  if (error instanceof Error && pending.length < MAX_PENDING) pending.push(error);
}
const onError = (event: ErrorEvent) => queue(event.error);
const onRejection = (event: PromiseRejectionEvent) => queue(event.reason);

function stopQueueing(): void {
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
}

/** Starts loading the SDK; the promise only matters to tests and never rejects. */
export function initBrowserErrorReporting(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (typeof window === 'undefined' || !dsn || sentry) return Promise.resolve();
  if (loading) return loading;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  loading = import('@/lib/sentry-browser').then(module => {
    // From here on the SDK's own global handlers take over.
    stopQueueing();
    if (!module.startSentry(dsn)) throw new Error('Sentry did not start');
    sentry = module;
    for (const error of pending.splice(0)) module.captureBrowserError(error);
  }).catch(() => {
    // Monitoring must never break the page; a later call may try again.
    stopQueueing();
    pending.length = 0;
    loading = null;
  });
  return loading;
}

/** React boundaries handle errors before global listeners see them. */
export function reportBrowserError(error: Error): void {
  if (sentry) sentry.captureBrowserError(error);
  else if (loading) queue(error);
}
