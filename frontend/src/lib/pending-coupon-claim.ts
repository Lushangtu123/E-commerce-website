const keyPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const storageKey = (sessionKey: string, couponId: number) => `pending-coupon-claim:${sessionKey}:${couponId}`;

export function listPendingCouponClaims(sessionKey: string): { couponId: number; key: string }[] {
  try {
    const prefix = `pending-coupon-claim:${sessionKey}:`;
    const claims: { couponId: number; key: string }[] = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const storage = sessionStorage.key(index);
      if (!storage?.startsWith(prefix)) continue;
      const id = storage.slice(prefix.length), couponId = Number(id), key = sessionStorage.getItem(storage);
      if (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(couponId) && couponId <= 2147483647 && key && keyPattern.test(key)) claims.push({ couponId, key });
    }
    return claims;
  } catch { return []; }
}

/** Recovery IDs belong to one sign-in and one coupon; they contain no credentials. */
export function readPendingCouponClaim(sessionKey: string, couponId: number): string | null {
  try {
    const value = sessionStorage.getItem(storageKey(sessionKey, couponId));
    return value && keyPattern.test(value) ? value : null;
  } catch { return null; }
}

/** Refuse to write if an existing identity cannot be read or a new identity cannot be saved. */
export function prepareCouponClaim(sessionKey: string, couponId: number): string | null {
  try {
    const storage = storageKey(sessionKey, couponId);
    const previous = sessionStorage.getItem(storage);
    if (previous !== null) return keyPattern.test(previous) ? previous : null;
    const key = crypto.randomUUID();
    sessionStorage.setItem(storage, key);
    return key;
  } catch { return null; }
}

export function clearPendingCouponClaim(sessionKey: string, couponId: number, key: string): boolean {
  try {
    const storage = storageKey(sessionKey, couponId);
    if (sessionStorage.getItem(storage) === key) sessionStorage.removeItem(storage);
    return true;
  } catch { return false; }
}
