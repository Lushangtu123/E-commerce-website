import type { AddressInput } from '@/lib/api/account';

export interface PendingAddressCreation {
  key: string;
  input: AddressInput;
  /** Written before POST, because a refresh can interrupt a request after its server commit. */
  uncertain: boolean;
}
const storageKey = (sessionId: string, userId: number) => `pending-address-create:${sessionId}:${userId}`;
const names = ['receiver_name', 'phone', 'province', 'city', 'district', 'detail_address'] as const;

/** Malformed/unreadable receipts block a fresh intent instead of silently losing its retry identity. */
export function readPendingAddressCreation(sessionId: string, userId: number): PendingAddressCreation | null {
  const value = sessionStorage.getItem(storageKey(sessionId, userId));
  if (value === null) return null;
  const attempt = JSON.parse(value) as PendingAddressCreation;
  if (!attempt || typeof attempt.key !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(attempt.key) ||
    typeof attempt.uncertain !== 'boolean' || !attempt.input || typeof attempt.input !== 'object' || Array.isArray(attempt.input) ||
    names.some(name => typeof attempt.input[name] !== 'string' || !attempt.input[name].trim()) ||
    typeof attempt.input.is_default !== 'boolean' || Object.keys(attempt.input).some(name => ![...names, 'is_default'].includes(name))) {
    throw new Error('Invalid pending address creation');
  }
  return attempt;
}

export function storePendingAddressCreation(sessionId: string, userId: number, attempt: PendingAddressCreation): boolean {
  try {
    const previous = readPendingAddressCreation(sessionId, userId);
    if (previous && (previous.key !== attempt.key || JSON.stringify(previous.input) !== JSON.stringify(attempt.input) ||
      (previous.uncertain && !attempt.uncertain))) return false;
    const value = JSON.stringify(attempt);
    sessionStorage.setItem(storageKey(sessionId, userId), value);
    return sessionStorage.getItem(storageKey(sessionId, userId)) === value;
  } catch { return false; }
}

export function clearPendingAddressCreation(sessionId: string, userId: number, key: string): boolean {
  try {
    const previous = readPendingAddressCreation(sessionId, userId);
    if (previous && previous.key !== key) return false;
    sessionStorage.removeItem(storageKey(sessionId, userId));
    return sessionStorage.getItem(storageKey(sessionId, userId)) === null;
  } catch { return false; }
}
