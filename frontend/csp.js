/**
 * Content Security Policy for every page (see tests/csp.test.ts).
 *
 * Enforced: only this site's scripts, connections only to this site, the API origin and the Sentry ingest
 * host, no plugins, frames, foreign <base> or form targets. Inline scripts stay allowed because statically
 * rendered pages cannot carry a per-request nonce.
 * Report-only trial: the same policy without inline scripts, reported to Sentry's CSP endpoint when a DSN is
 * set, to measure what a strict (nonce-based) policy would break before deciding to enforce it.
 * A report carries the full page URL including its query, so pages whose URL holds a secret (the password
 * reset link) get the trial without a report endpoint.
 */
function origin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null; // A relative API path is same-origin; an invalid DSN adds nothing.
  }
}

function sentryReportUri(dsn) {
  try {
    const parsed = new URL(dsn);
    const project = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (!parsed.username || !/^\d+$/.test(project)) return null;
    return `${parsed.origin}/api/${project}/security/?sentry_key=${encodeURIComponent(parsed.username)}`;
  } catch {
    return null;
  }
}

function serialize(directives) {
  return Object.entries(directives).map(([name, values]) => [name, ...values].join(' ')).join('; ');
}

/** @param {{ dev: boolean, apiUrl?: string, sentryDsn?: string }} options */
function buildContentSecurityPolicy({ dev, apiUrl = '', sentryDsn = '' }) {
  const connect = ["'self'", origin(apiUrl), origin(sentryDsn), ...(dev ? ['ws:'] : [])].filter(Boolean);
  const scripts = ["'self'", ...(dev ? ["'unsafe-eval'", 'https://va.vercel-scripts.com'] : [])];
  const base = {
    'default-src': ["'self'"],
    'script-src': scripts,
    'style-src': ["'self'", "'unsafe-inline'"],
    // Product images and avatars are arbitrary HTTPS links entered by administrators and customers.
    'img-src': ["'self'", 'https:', 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [...new Set(connect)],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
    // No upgrade-insecure-requests: a Docker deployment served over plain HTTP would lose its own scripts.
    // Browsers already block mixed content, and Vercel serves HTTPS only.
  };
  const enforced = { ...base, 'script-src': [scripts[0], "'unsafe-inline'", ...scripts.slice(1)] };
  const reportUri = sentryReportUri(sentryDsn);
  const reportOnly = { ...base, ...(reportUri ? { 'report-uri': [reportUri] } : {}) };
  return { enforced: serialize(enforced), reportOnly: serialize(reportOnly), reportOnlyUnreported: serialize(base) };
}

/** Pages whose URL carries a secret in the query string; their CSP reports would send it to Sentry. */
const SECRET_URL_PATHS = ['/reset-password', '/reset-password/:path*'];

module.exports = { buildContentSecurityPolicy, SECRET_URL_PATHS };
