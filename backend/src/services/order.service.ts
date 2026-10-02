import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { getPool } from '../database/mysql';
import { getRedisClient } from '../database/redis';
import { OrderModel, OrderStatus } from '../models/order.model';
import logger from '../utils/logger';
import { calculateDiscountCents } from '../utils/coupon-discount';
import { CouponModel } from '../models/coupon.model';

import { PurchaseError as OrderError, MAX_QUANTITY, normalizePurchaseItems as normalizeItems, pricePurchaseItems as priceItems } from './purchase-items.service';
export { PurchaseError as OrderError } from './purchase-items.service';

interface LockedCoupon extends RowDataPacket {
  coupon_id: number;
  name: string;
  code: string;
  type: number;
  discount_value: string;
  min_amount: string;
  max_discount: string | null;
  end_time: Date;
  usable: number;
}

function validateCouponId(userCouponId: unknown): void {
  if (userCouponId !== undefined && (!Number.isSafeInteger(userCouponId) || Number(userCouponId) <= 0 || Number(userCouponId) > MAX_QUANTITY)) {
    throw new OrderError('优惠券ID无效');
  }
}

/** Consistent definition -> user-coupon locking also matches the claim transaction. */
async function lockCouponDefinition(connection: PoolConnection, userId: number, userCouponId: number): Promise<LockedCoupon | undefined> {
  const [received] = await connection.execute<RowDataPacket[]>(
    'SELECT coupon_id FROM user_coupons WHERE user_coupon_id = ? AND user_id = ?', [userCouponId, userId]
  );
  if (!received[0]) return undefined;
  const [definitions] = await connection.execute<LockedCoupon[]>(
    `SELECT *, (status = 1 AND start_time <= NOW() AND end_time > NOW()) AS usable
     FROM coupons WHERE coupon_id = ? FOR UPDATE`, [received[0].coupon_id]
  );
  return definitions[0];
}

/** Indicative server quote only; createOrder rechecks everything inside its transaction. */
export async function previewOrder(userId: number, items: unknown, userCouponId?: number) {
  const normalizedItems = normalizeItems(items);
  validateCouponId(userCouponId);
  const connection = await getPool().getConnection();
  try {
    const { totalCents } = await priceItems(connection, normalizedItems, false);
    const available = await CouponModel.getAvailableForOrder(userId, totalCents / 100, connection);
    const selected = userCouponId === undefined ? undefined : available.find(coupon => coupon.user_coupon_id === userCouponId);
    if (userCouponId !== undefined && !selected) throw new OrderError('优惠券已失效或订单金额不满足使用条件，请重新选择');
    const discountCents = selected ? calculateDiscountCents(selected, totalCents) : 0;
    return {
      original_amount: totalCents / 100,
      discount_amount: discountCents / 100,
      total_amount: (totalCents - discountCents) / 100,
      coupon: selected ? { user_coupon_id: selected.user_coupon_id, name: selected.name, code: selected.code } : null,
      available_coupons: available,
    };
  } finally { connection.release(); }
}

/** Order, line items, inventory and cart changes share this connection and transaction. */
export async function createOrder(
  userId: number,
  items: unknown,
  shippingAddressId?: number,
  remark?: string,
  userCouponId?: number
): Promise<{ orderId: number; productIds: number[]; original_amount: number; discount_amount: number; total_amount: number }> {
  const normalizedItems = normalizeItems(items);
  validateCouponId(userCouponId);
  if (remark !== undefined && (typeof remark !== 'string' || remark.length > 2000)) throw new OrderError('订单备注无效');
  if (shippingAddressId !== undefined &&
      (!Number.isSafeInteger(shippingAddressId) || shippingAddressId <= 0)) {
    throw new OrderError('收货地址ID无效');
  }
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    if (shippingAddressId !== undefined) {
      const [addresses] = await connection.execute<RowDataPacket[]>(
        'SELECT address_id FROM shipping_addresses WHERE address_id = ? AND user_id = ? FOR UPDATE',
        [shippingAddressId, userId]
      );
      if (addresses.length === 0) throw new OrderError('收货地址不存在或不属于当前用户');
    }

    const { orderItems, totalCents } = await priceItems(connection, normalizedItems, true);

    let coupon: LockedCoupon | undefined;
    let discountCents = 0;
    if (userCouponId !== undefined) {
      coupon = await lockCouponDefinition(connection, userId, userCouponId);
      const [received] = await connection.execute<RowDataPacket[]>(
        `SELECT *, (expired_at > NOW()) AS not_expired FROM user_coupons
         WHERE user_coupon_id = ? AND user_id = ? FOR UPDATE`, [userCouponId, userId]
      );
      const userCoupon = received[0];
      if (!coupon || Number(coupon.usable) !== 1 || !userCoupon || userCoupon.status !== 1 ||
          Number(userCoupon.not_expired) !== 1 || userCoupon.coupon_id !== coupon.coupon_id) {
        throw new OrderError('优惠券不存在、已使用或已失效');
      }
      try { discountCents = calculateDiscountCents(coupon, totalCents); }
      catch { throw new OrderError('优惠券配置无效'); }
      if (discountCents <= 0) throw new OrderError('订单金额不满足优惠券使用条件');
    }
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO orders (order_no, user_id, total_amount, shipping_address_id, remark, status,
                          original_amount, discount_amount, user_coupon_id, coupon_name, coupon_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [OrderModel.generateOrderNo(), userId, ((totalCents - discountCents) / 100).toFixed(2),
        shippingAddressId ?? null, remark ?? null, OrderStatus.PENDING,
        (totalCents / 100).toFixed(2), (discountCents / 100).toFixed(2), userCouponId ?? null, coupon?.name ?? null, coupon?.code ?? null]
    );
    const orderId = result.insertId;
    if (coupon && userCouponId !== undefined) {
      const [used] = await connection.execute<ResultSetHeader>(
        `UPDATE user_coupons SET status = 2, used_at = NOW(), order_id = ?
         WHERE user_coupon_id = ? AND user_id = ? AND status = 1 AND expired_at > NOW()`,
        [orderId, userCouponId, userId]
      );
      if (used.affectedRows !== 1) throw new OrderError('优惠券状态已改变，请重新选择');
      await connection.execute(
        `INSERT INTO coupon_usage_logs (user_id, coupon_id, user_coupon_id, order_id, discount_amount, order_amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, coupon.coupon_id, userCouponId, orderId, (discountCents / 100).toFixed(2), (totalCents / 100).toFixed(2)]
      );
    }
    for (const item of orderItems) {
      const [deduction] = await connection.execute<ResultSetHeader>(
        item.sku
          ? 'UPDATE product_skus SET stock = stock - ? WHERE sku_id = ? AND product_id = ? AND status = 1 AND stock >= ?'
          : 'UPDATE products SET stock = stock - ? WHERE product_id = ? AND stock >= ?',
        item.sku ? [item.quantity, item.sku.sku_id, item.product_id, item.quantity] : [item.quantity, item.product_id, item.quantity]
      );
      if (deduction.affectedRows !== 1) throw new OrderError(`商品 ${item.product.title} 库存不足`);
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, sku_id, sku_code, sku_specs, quantity, price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.product.title, item.sku?.image || item.product.main_image || null,
          item.sku?.sku_id ?? null, item.sku?.sku_code ?? null, item.sku ? JSON.stringify(item.sku.specs) : null, item.quantity, item.price]
      );
    }
    const productIds = [...new Set(normalizedItems.map(item => item.product_id))];
    await connection.execute(
      `DELETE FROM cart WHERE user_id = ? AND (${normalizedItems.map(() => '(product_id = ? AND sku_key = ?)').join(' OR ')})`,
      [userId, ...normalizedItems.flatMap(item => [item.product_id, item.sku_id ?? 0])]
    );
    await connection.commit();
    return { orderId, productIds, original_amount: totalCents / 100, discount_amount: discountCents / 100, total_amount: (totalCents - discountCents) / 100 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

interface LockedOrder extends RowDataPacket {
  order_id: number;
  order_no: string;
  user_id: number;
  status: OrderStatus;
  has_timed_out: number;
  user_coupon_id: number | null;
}

export interface OrderTransitionResult {
  orderNo: string;
  productIds: number[];
  changed: boolean;
}

/** Payment, manual cancellation and timeout consumers all acquire the same order lock. */
export async function transitionOrder(
  orderId: number,
  targetStatus: OrderStatus,
  options: { userId?: number; timeoutOnly?: boolean } = {}
): Promise<OrderTransitionResult> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new OrderError('订单ID无效');
  if (!Number.isInteger(targetStatus) || targetStatus < OrderStatus.PENDING || targetStatus > OrderStatus.CANCELLED) {
    throw new OrderError('订单状态无效');
  }
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.execute<LockedOrder[]>(
      `SELECT order_id, order_no, user_id, status, user_coupon_id,
              (created_at <= DATE_SUB(NOW(), INTERVAL 30 MINUTE)) AS has_timed_out
       FROM orders WHERE order_id = ? FOR UPDATE`,
      [orderId]
    );
    const order = orders[0];
    if (options.timeoutOnly && (!order || order.status !== OrderStatus.PENDING || Number(order.has_timed_out) !== 1)) {
      await connection.rollback();
      return { orderNo: order?.order_no || '', productIds: [], changed: false };
    }
    if (!order) throw new OrderError('订单不存在', 404);
    if (options.userId !== undefined && order.user_id !== options.userId) {
      throw new OrderError('无权操作该订单', 403);
    }
    const previousStatus: Partial<Record<OrderStatus, OrderStatus>> = {
      [OrderStatus.PAID]: OrderStatus.PENDING,
      [OrderStatus.CANCELLED]: OrderStatus.PENDING,
      [OrderStatus.SHIPPED]: OrderStatus.PAID,
      [OrderStatus.COMPLETED]: OrderStatus.SHIPPED,
    };
    if (previousStatus[targetStatus] === undefined || order.status !== previousStatus[targetStatus]) {
      throw new OrderError('订单状态不允许此操作');
    }

    const productIds: number[] = [];
    if (targetStatus === OrderStatus.PAID || targetStatus === OrderStatus.CANCELLED) {
      const [items] = await connection.execute<RowDataPacket[]>(
        'SELECT product_id, sku_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id, sku_id', [orderId]
      );
      const productQuantities = new Map<number, number>();
      const inventory = new Map<string, { productId: number; skuId: number | null; quantity: number }>();
      for (const item of items) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('订单商品数量无效');
        productQuantities.set(item.product_id, (productQuantities.get(item.product_id) || 0) + item.quantity);
        const key = `${item.product_id}:${item.sku_id ?? 0}`;
        inventory.set(key, { productId: item.product_id, skuId: item.sku_id ?? null, quantity: (inventory.get(key)?.quantity || 0) + item.quantity });
      }
      for (const [productId, quantity] of [...productQuantities.entries()].sort(([a], [b]) => a - b)) {
        if (!Number.isSafeInteger(quantity) || quantity > MAX_QUANTITY) throw new Error('订单商品数量无效');
        const [parents] = await connection.execute<RowDataPacket[]>(
          'SELECT product_id FROM products WHERE product_id = ? FOR UPDATE', [productId]
        );
        if (!parents[0]) throw new Error('订单商品不存在');
        if (targetStatus === OrderStatus.PAID) {
          await connection.execute('UPDATE products SET sales_count = sales_count + ? WHERE product_id = ?', [quantity, productId]);
        }
        productIds.push(productId);
      }
      if (targetStatus === OrderStatus.CANCELLED) {
        for (const item of [...inventory.values()].sort((a, b) => (a.skuId ?? 0) - (b.skuId ?? 0) || a.productId - b.productId)) {
          const [result] = await connection.execute<ResultSetHeader>(
            item.skuId === null
              ? 'UPDATE products SET stock = stock + ? WHERE product_id = ? AND stock <= ?'
              : 'UPDATE product_skus SET stock = stock + ? WHERE sku_id = ? AND product_id = ? AND stock <= ?',
            item.skuId === null
              ? [item.quantity, item.productId, MAX_QUANTITY - item.quantity]
              : [item.quantity, item.skuId, item.productId, MAX_QUANTITY - item.quantity]
          );
          if (result.affectedRows !== 1) throw new Error('订单商品库存无法回补');
        }
      }
    }

    if (targetStatus === OrderStatus.CANCELLED && order.user_coupon_id) {
      const coupon = await lockCouponDefinition(connection, order.user_id, order.user_coupon_id);
      // Do not touch a coupon already rebound to another order; retain this order's snapshot/log.
      await connection.execute(
        `UPDATE user_coupons SET status = CASE WHEN expired_at <= NOW() OR ? <= NOW() THEN 3 ELSE 1 END,
                                 used_at = NULL, order_id = NULL
         WHERE user_coupon_id = ? AND user_id = ? AND status = 2 AND order_id = ?`,
        [coupon?.end_time ?? null, order.user_coupon_id, order.user_id, orderId]
      );
    }

    const timeField: Partial<Record<OrderStatus, string>> = {
      [OrderStatus.PAID]: 'paid_at',
      [OrderStatus.SHIPPED]: 'shipped_at',
      [OrderStatus.COMPLETED]: 'completed_at',
    };
    const timeUpdate = timeField[targetStatus] ? `, ${timeField[targetStatus]} = NOW()` : '';
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE orders SET status = ?${timeUpdate} WHERE order_id = ? AND status = ?`,
      [targetStatus, orderId, order.status]
    );
    if (updated.affectedRows !== 1) throw new OrderError('订单状态已改变');
    await connection.commit();
    return { orderNo: order.order_no, productIds, changed: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Cache invalidation happens after commit; cache availability cannot undo an order. */
export async function invalidateOrderProductCache(productIds: number[]): Promise<void> {
  if (productIds.length === 0) return;
  try {
    await getRedisClient().del(...productIds.map(id => `product:${id}`), 'products:hot');
  } catch (error) {
    logger.warn({ err: error }, '订单已提交，商品缓存清理失败');
  }
}
