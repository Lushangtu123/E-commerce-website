// Search terms and password-reset fragments must not enter telemetry.
export function redactTelemetryUrl<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
