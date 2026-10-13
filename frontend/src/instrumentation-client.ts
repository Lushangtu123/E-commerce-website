import { initBrowserErrorReporting } from './lib/error-reporting';

// Next runs this before hydration. Without NEXT_PUBLIC_SENTRY_DSN nothing is loaded; with it the SDK
// arrives in its own chunk, and errors raised meanwhile are queued.
void initBrowserErrorReporting();
