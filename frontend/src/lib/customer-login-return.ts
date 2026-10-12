/** Keep customer sign-in destinations local and outside authentication/admin routes. */
export function safeCustomerReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://customer.invalid');
    if (url.origin !== 'https://customer.invalid') return '/';
    const pathname = decodeURIComponent(url.pathname);
    // Encoded separators and nested encoding must never become another origin or hidden route.
    if (/[\\\u0000-\u0020\u007f]/.test(pathname) || pathname.startsWith('//') || /%(?:2f|5c|25)/i.test(url.pathname)) return '/';
    if (/^\/(?:login|register|admin|api)(?:\/|$)/i.test(pathname)) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

export function customerReturnPath(): string {
  if (typeof window === 'undefined') return '/';
  return safeCustomerReturnPath(new URLSearchParams(window.location.search).get('next'));
}

/** URL state is external to React; back/forward must refresh the auth-switch link. */
export function subscribeCustomerReturnPath(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export function customerAuthHref(route: '/login' | '/register', destination: string): string {
  const next = safeCustomerReturnPath(destination);
  return next === '/' ? route : `${route}?next=${encodeURIComponent(next)}`;
}

/** Navigation only: signing in does not replay the action that asked for authentication. */
export function customerLoginHref(): string {
  return customerAuthHref('/login', typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search);
}
