import type { Category } from '@/lib/api/admin';

/** A successful category read must be a complete usable array, including a genuine empty one. */
export function readCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) throw new Error('Invalid category list');
  const ids = new Set<number>();
  for (const row of value) {
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.category_id) || row.category_id <= 0 ||
        row.category_id > 2147483647 || ids.has(row.category_id) || typeof row.name !== 'string' || !row.name.trim()) {
      throw new Error('Invalid category');
    }
    ids.add(row.category_id);
  }
  return value as Category[];
}
