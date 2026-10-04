import type { AdminSKU, AdminSKUInput } from '@/lib/api';

export type SpecRow = { name: string; value: string; originalValue?: string | number | boolean };
export type SKUDraft = { sku_code: string; price: string; original_price: string; stock: string; image: string; status: string; specs: SpecRow[] };

export function skuDraft(sku?: AdminSKU): SKUDraft {
  return { sku_code: sku?.sku_code ?? '', price: sku ? String(sku.price) : '', original_price: sku?.original_price == null ? '' : String(sku.original_price),
    stock: String(sku?.stock ?? 0), image: sku?.image ?? '', status: String(sku?.status ?? 1),
    specs: sku ? Object.entries(sku.specs).map(([name, value]) => ({ name, value: String(value), originalValue: value })) : [{ name: '', value: '' }] };
}

export function parseSKUForm(draft: SKUDraft): AdminSKUInput {
  const fail = (message: string): never => { throw new Error(message); };
  const code = draft.sku_code.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/.test(code)) fail('规格编码须为1至50个字符，以字母或数字开头，可含点、下划线和连字符');
  const money = (text: string): number => {
    const value = text.trim();
    const number = Number(value);
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(number) || number > 99999999.99) fail('金额须为0至99999999.99，最多两位小数');
    return number;
  };
  const stock = Number(draft.stock.trim());
  if (!/^\d+$/.test(draft.stock.trim()) || !Number.isSafeInteger(stock) || stock < 0 || stock > 2147483647) fail('库存须为0至2147483647的整数');
  if (draft.status !== '0' && draft.status !== '1') fail('规格状态无效');
  if (draft.image.trim().length > 255) fail('图片地址最多255个字符');
  if (draft.specs.length < 1 || draft.specs.length > 20) fail('请填写1至20项规格，每项名称最多50个字符，文本值最多100个字符');
  const names = new Set<string>();
  const entries = draft.specs.map(row => {
    const name = row.name.trim(), text = row.value.trim();
    if (!name || name.length > 50 || !text || (typeof row.originalValue !== 'number' && typeof row.originalValue !== 'boolean' && text.length > 100)) fail('请填写1至20项规格，每项名称最多50个字符，文本值最多100个字符');
    if (names.has(name)) fail('规格名称不能重复');
    names.add(name);
    const value = row.originalValue !== undefined && row.value === String(row.originalValue) ? row.originalValue : text;
    if ((typeof value === 'string' && value.length > 100) || (typeof value === 'number' && !Number.isFinite(value))) fail('请填写1至20项规格，每项名称最多50个字符，文本值最多100个字符');
    return [name, value] as const;
  });
  return { sku_code: code, specs: Object.fromEntries(entries), price: money(draft.price), original_price: draft.original_price.trim() ? money(draft.original_price) : null,
    stock, image: draft.image.trim() || null, status: Number(draft.status) as 0 | 1 };
}

// Omit untouched fields, especially stock that may have changed through purchases.
export function skuChanges(input: AdminSKUInput, previous: AdminSKU): Partial<AdminSKUInput> {
  const changes: Partial<AdminSKUInput> = {};
  if (input.sku_code !== previous.sku_code) changes.sku_code = input.sku_code;
  if (input.price !== Number(previous.price)) changes.price = input.price;
  if (input.original_price !== (previous.original_price == null ? null : Number(previous.original_price))) changes.original_price = input.original_price;
  if (input.stock !== previous.stock) changes.stock = input.stock;
  if (input.image !== (previous.image || null)) changes.image = input.image;
  if (input.status !== previous.status) changes.status = input.status;
  if (Object.keys(input.specs).length !== Object.keys(previous.specs).length ||
    Object.entries(input.specs).some(([name, value]) => !Object.hasOwn(previous.specs, name) || previous.specs[name] !== value)) changes.specs = input.specs;
  return changes;
}
