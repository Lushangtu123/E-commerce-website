import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '../database/mysql';
import { getRedisClient } from '../database/redis';
import { OrderModel, OrderStatus } from '../models/order.model';
import logger from '../utils/logger';

export class OrderError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
  }
}

interface OrderInputItem {
  product_id: number;
  quantity: number;
}

interface OrderProduct extends RowDataPacket {
  product_id: number;
  title: string;
  price: string | number;
  stock: number;
  main_image: string | null;
  status: number;
}

const MAX_QUANTITY = 2147483647;
const MAX_AMOUNT_CENTS = 9999999999; // orders.total_amount DECIMAL(10,2)

function normalizeItems(items: unknown): OrderInputItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new OrderError('订单商品不能为空');
  }
  const quantities = new Map<number, number>();
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.product_id) || item.product_id <= 0 ||
        !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new OrderError('商品ID和数量必须为正整数');
    }
    const quantity = (quantities.get(item.product_id) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > MAX_QUANTITY) {
      throw new OrderError('商品数量超出范围');
    }
    quantities.set(item.product_id, quantity);
  }
  return [...quantities.entries()]
    .sort(([left], [right]) => left - right)
    .map(([product_id, quantity]) => ({ product_id, quantity }));
}

/** Order, line items, inventory and cart changes share this connection and transaction. */
export async function createOrder(
  userId: number,
  items: unknown,
  shippingAddressId?: number,
  remark?: string
): Promise<{ orderId: number; productIds: number[] }> {
  const normalizedItems = normalizeItems(items);
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

    const orderItems: Array<OrderInputItem & { product: OrderProduct; price: string }> = [];
    let totalCents = 0;
    // Acquire product locks in a consistent order to reduce multi-product deadlocks.
    for (const item of normalizedItems) {
      const [products] = await connection.execute<OrderProduct[]>(
        'SELECT product_id, title, price, stock, main_image, status FROM products WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );
      const product = products[0];
      if (!product || product.status !== 1) throw new OrderError(`商品 ${item.product_id} 不存在或已下架`);
      if (product.stock < item.quantity) throw new OrderError(`商品 ${product.title} 库存不足`);
      const priceCents = Math.round(Number(product.price) * 100);
      if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new Error('商品价格无效');
      totalCents += priceCents * item.quantity;
      if (!Number.isSafeInteger(totalCents) || totalCents > MAX_AMOUNT_CENTS) {
        throw new OrderError('订单金额超出范围');
      }
      orderItems.push({ ...item, product, price: (priceCents / 100).toFixed(2) });
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO orders (order_no, user_id, total_amount, shipping_address_id, remark, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [OrderModel.generateOrderNo(), userId, (totalCents / 100).toFixed(2),
        shippingAddressId ?? null, remark ?? null, OrderStatus.PENDING]
    );
    const orderId = result.insertId;
    for (const item of orderItems) {
      const [deduction] = await connection.execute<ResultSetHeader>(
        'UPDATE products SET stock = stock - ? WHERE product_id = ? AND stock >= ?',
        [item.quantity, item.product_id, item.quantity]
      );
      if (deduction.affectedRows !== 1) throw new OrderError(`商品 ${item.product.title} 库存不足`);
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.product.title, item.product.main_image ?? null, item.quantity, item.price]
      );
    }
    const productIds = normalizedItems.map(item => item.product_id);
    await connection.execute(
      `DELETE FROM cart WHERE user_id = ? AND product_id IN (${productIds.map(() => '?').join(',')})`,
      [userId, ...productIds]
    );
    await connection.commit();
    return { orderId, productIds };
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
      `SELECT order_id, order_no, user_id, status,
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
        'SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id',
        [orderId]
      );
      const quantities = new Map<number, number>();
      for (const item of items) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('订单商品数量无效');
        quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.quantity);
      }
      for (const [productId, quantity] of [...quantities.entries()].sort(([left], [right]) => left - right)) {
        const sql = targetStatus === OrderStatus.CANCELLED
          ? 'UPDATE products SET stock = stock + ? WHERE product_id = ?'
          : 'UPDATE products SET sales_count = sales_count + ? WHERE product_id = ?';
        const [result] = await connection.execute<ResultSetHeader>(sql, [quantity, productId]);
        if (result.affectedRows !== 1) throw new Error('订单商品不存在');
        productIds.push(productId);
      }
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
