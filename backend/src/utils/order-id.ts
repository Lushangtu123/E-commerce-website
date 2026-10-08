/** Order IDs are BIGINTs; accept only their canonical, positive, safe decimal representation. */
export function orderPathId(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && String(id) === value ? id : undefined;
}
