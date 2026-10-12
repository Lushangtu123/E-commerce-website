/** Per-tab checkout choices contain line identities only, never prices or personal data. */
const storageKey = (sessionKey: string) => `checkout-selection:${sessionKey}`;
const validKey = (key: unknown): key is string => typeof key === 'string' && /^[1-9]\d*:(?:base|[1-9]\d*)$/.test(key) &&
  key.split(':').every(value => value === 'base' || Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647);

export function readCheckoutSelection(sessionKey: string): string[] | null {
  const raw = sessionStorage.getItem(storageKey(sessionKey));
  if (raw === null) return null;
  const keys: unknown = JSON.parse(raw);
  if (!Array.isArray(keys) || keys.length > 100 || !keys.every(validKey) || new Set(keys).size !== keys.length) throw new Error('Invalid checkout selection');
  return keys;
}

export function storeCheckoutSelection(sessionKey: string, keys: string[]): boolean {
  try {
    const raw = JSON.stringify(keys);
    sessionStorage.setItem(storageKey(sessionKey), raw);
    return sessionStorage.getItem(storageKey(sessionKey)) === raw;
  } catch { return false; }
}

export function clearCheckoutSelection(sessionKey: string): void {
  try { sessionStorage.removeItem(storageKey(sessionKey)); } catch { /* Storage may become unavailable after the order has been confirmed. */ }
}
