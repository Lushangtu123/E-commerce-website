export interface PendingProductCreation { key: string; input: Record<string, unknown> }
const storageKey = (sessionId: string) => `pending-product-create:${sessionId}`;

/** Per-tab public product input and retry identity; malformed or unreadable storage must block a new intent. */
export function readPendingProductCreation(sessionId: string): PendingProductCreation | null {
  const value = sessionStorage.getItem(storageKey(sessionId));
  if (value === null) return null;
  const attempt = JSON.parse(value) as PendingProductCreation;
  if (!attempt || typeof attempt.key !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(attempt.key) ||
    !attempt.input || Array.isArray(attempt.input) || typeof attempt.input !== 'object' || typeof attempt.input.title !== 'string' ||
    typeof attempt.input.price !== 'number' || !Number.isFinite(attempt.input.price) ||
    !Number.isSafeInteger(attempt.input.category_id) || Number(attempt.input.category_id) <= 0) throw new Error('Invalid pending product creation');
  return attempt;
}

export function storePendingProductCreation(sessionId: string, attempt: PendingProductCreation): boolean {
  try {
    const stored = sessionStorage.getItem(storageKey(sessionId)), value = JSON.stringify(attempt);
    if (stored !== null && stored !== value) return false;
    sessionStorage.setItem(storageKey(sessionId), value);
    return sessionStorage.getItem(storageKey(sessionId)) === value;
  } catch { return false; }
}

export function clearPendingProductCreation(sessionId: string, key: string): boolean {
  try {
    const attempt = readPendingProductCreation(sessionId);
    if (attempt && attempt.key !== key) return false;
    sessionStorage.removeItem(storageKey(sessionId));
    return sessionStorage.getItem(storageKey(sessionId)) === null;
  } catch { return false; }
}
