import { RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { couponMoneyToCents } from '../utils/coupon-discount';

export class PurchaseError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

export const MAX_QUANTITY = 2147483647;
export interface PurchaseItem { product_id: number; sku_id?: number; quantity: number }
interface Product extends RowDataPacket {
  product_id: number; title: string; price: number | string; stock: number; status: number; main_image: string | null;
}
interface SKU extends RowDataPacket {
  sku_id: number; product_id: number; sku_code: string; specs: Record<string, unknown>;
  price: number | string; stock: number; status: number; image: string | null;
}
export interface PricedItem extends PurchaseItem { product: Product; sku?: SKU; price: string }

export function normalizePurchaseItems(items: unknown): PurchaseItem[] {
  if (!Array.isArray(items) || !items.length) throw new PurchaseError('订单商品不能为空');
  const merged = new Map<string, PurchaseItem>();
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.product_id) || item.product_id <= 0 || item.product_id > MAX_QUANTITY ||
        !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > MAX_QUANTITY) {
      throw new PurchaseError('商品ID和数量必须为正整数');
    }
    const skuId = item.sku_id == null ? undefined : item.sku_id;
    if (skuId !== undefined && (!Number.isSafeInteger(skuId) || skuId <= 0 || skuId > MAX_QUANTITY)) {
      throw new PurchaseError('规格ID无效');
    }
    const key = `${item.product_id}:${skuId ?? 0}`;
    const quantity = (merged.get(key)?.quantity || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > MAX_QUANTITY) throw new PurchaseError('商品数量超出范围');
    merged.set(key, { product_id: item.product_id, ...(skuId === undefined ? {} : { sku_id: skuId }), quantity });
  }
  return [...merged.values()].sort((a, b) => a.product_id - b.product_id || (a.sku_id ?? 0) - (b.sku_id ?? 0));
}

/** All parent locks precede SKU locks, matching SKU administration and avoiding a first-SKU race. */
export async function pricePurchaseItems(connection: PoolConnection, items: PurchaseItem[], lock: boolean) {
  const productIds = [...new Set(items.map(item => item.product_id))].sort((a, b) => a - b);
  const products = new Map<number, Product>();
  for (const productId of productIds) {
    const [rows] = await connection.execute<Product[]>(
      `SELECT product_id, title, price, stock, main_image, status FROM products WHERE product_id = ?${lock ? ' FOR UPDATE' : ''}`, [productId]
    );
    if (!rows[0] || rows[0].status !== 1) throw new PurchaseError(`商品 ${productId} 不存在或已下架`);
    products.set(productId, rows[0]);
  }
  // A locking current read sees even the first SKU committed while waiting for a parent lock.
  const [skus] = await connection.execute<SKU[]>(
    `SELECT sku_id, product_id, sku_code, specs, price, stock, status, image FROM product_skus
     WHERE product_id IN (${productIds.map(() => '?').join(',')}) ORDER BY sku_id${lock ? ' FOR UPDATE' : ''}`, productIds
  );
  const variants = new Map(skus.map(sku => [sku.sku_id, sku]));
  const hasSKU = new Set(skus.map(sku => sku.product_id));
  const orderItems: PricedItem[] = [];
  let totalCents = 0;
  for (const item of items) {
    const product = products.get(item.product_id)!;
    const sku = item.sku_id === undefined ? undefined : variants.get(item.sku_id);
    if (item.sku_id !== undefined && (!sku || sku.product_id !== item.product_id || sku.status !== 1)) {
      throw new PurchaseError(`商品 ${product.title} 的规格不存在或已停用`);
    }
    if (!sku && hasSKU.has(item.product_id)) throw new PurchaseError(`请选择商品 ${product.title} 的规格`);
    if ((sku ?? product).stock < item.quantity) throw new PurchaseError(`商品 ${product.title} 库存不足`);
    let priceCents: number;
    try { priceCents = couponMoneyToCents((sku ?? product).price); }
    catch { throw new PurchaseError('商品价格无效'); }
    totalCents += priceCents * item.quantity;
    if (!Number.isSafeInteger(totalCents) || totalCents > 9999999999) throw new PurchaseError('订单金额超出范围');
    orderItems.push({ ...item, product, sku, price: (priceCents / 100).toFixed(2) });
  }
  return { orderItems, totalCents };
}
