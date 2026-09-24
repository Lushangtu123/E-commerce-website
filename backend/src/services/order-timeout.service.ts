/**
 * 订单超时自动取消服务
 * 定期检查待支付订单，超时自动取消并恢复库存
 */

import { getPool } from '../database/mysql';
import { RowDataPacket } from 'mysql2';

interface PendingOrder extends RowDataPacket {
  order_id: number;
  order_no: string;
  user_id: number;
  created_at: Date;
}

interface OrderItem extends RowDataPacket {
  item_id: number;
  product_id: number;
  sku_id: number | null;
  quantity: number;
}

/**
 * 订单超时配置（分钟）
 */
const ORDER_TIMEOUT_MINUTES = 30;

/**
 * 取消单个超时订单：恢复库存并更新状态
 * 仅当订单仍为待支付（status = 0）时执行，否则返回 false
 */
export async function cancelTimeoutOrder(orderId: number): Promise<boolean> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. 确认订单仍为待支付
    const [orders] = await connection.execute<PendingOrder[]>(
      'SELECT order_id, order_no, user_id, created_at FROM orders WHERE order_id = ? AND status = 0',
      [orderId]
    );

    if (orders.length === 0) {
      await connection.rollback();
      return false;
    }
    const order = orders[0];

    // 2. 获取订单商品信息
    const [orderItems] = await connection.execute<OrderItem[]>(
      'SELECT item_id, product_id, sku_id, quantity FROM order_items WHERE order_id = ?',
      [order.order_id]
    );

    // 3. 恢复库存
    for (const item of orderItems) {
      if (item.sku_id) {
        // 恢复 SKU 库存
        await connection.execute(
          'UPDATE product_skus SET stock = stock + ? WHERE sku_id = ?',
          [item.quantity, item.sku_id]
        );
      } else {
        // 恢复商品库存
        await connection.execute(
          'UPDATE products SET stock = stock + ? WHERE product_id = ?',
          [item.quantity, item.product_id]
        );
      }
    }

    // 4. 更新订单状态为已取消
    await connection.execute(
      `UPDATE orders 
       SET status = 4
       WHERE order_id = ?`,
      [order.order_id]
    );

    await connection.commit();
    console.log(`[订单超时] 订单 ${order.order_no} 已自动取消，库存已恢复`);
    return true;
  } catch (error) {
    await connection.rollback();
    console.error(`[订单超时] 取消订单 ${orderId} 失败:`, error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 检查并取消超时订单
 */
export async function checkAndCancelTimeoutOrders(): Promise<void> {
  const pool = getPool();

  try {
    // 1. 查找超时的待支付订单
    const [timeoutOrders] = await pool.execute<PendingOrder[]>(
      `SELECT order_id, order_no, user_id, created_at 
       FROM orders 
       WHERE status = 0 
       AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > ?`,
      [ORDER_TIMEOUT_MINUTES]
    );

    console.log(`[订单超时检查] 发现 ${timeoutOrders.length} 个超时订单`);

    let successCount = 0;
    for (const order of timeoutOrders) {
      try {
        const cancelled = await cancelTimeoutOrder(order.order_id);
        if (cancelled) successCount++;
      } catch (error) {
        console.error(`[订单超时] 处理订单 ${order.order_no} 失败:`, error);
        // 继续处理下一个订单
      }
    }

    if (timeoutOrders.length > 0) {
      console.log(`[订单超时检查] 成功处理 ${successCount} 个超时订单`);
    }
  } catch (error) {
    console.error('[订单超时检查] 查询超时订单失败:', error);
    throw error;
  }
}

/**
 * 启动订单超时检查定时任务
 * 每5分钟执行一次
 */
export function startOrderTimeoutChecker(): NodeJS.Timeout {
  console.log('[订单超时检查] 定时任务已启动，每5分钟检查一次');
  
  // 立即执行一次
  checkAndCancelTimeoutOrders().catch(error => {
    console.error('[订单超时检查] 初始检查失败:', error);
  });

  // 每5分钟执行一次
  return setInterval(() => {
    checkAndCancelTimeoutOrders().catch(error => {
      console.error('[订单超时检查] 定时检查失败:', error);
    });
  }, 5 * 60 * 1000); // 5分钟
}

/**
 * 停止订单超时检查定时任务
 */
export function stopOrderTimeoutChecker(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  console.log('[订单超时检查] 定时任务已停止');
}

/**
 * 获取订单剩余支付时间（分钟）
 */
export async function getOrderRemainingTime(orderId: number): Promise<number> {
  const pool = getPool();
  
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT TIMESTAMPDIFF(MINUTE, created_at, NOW()) as elapsed_minutes
     FROM orders 
     WHERE order_id = ? AND status = 0`,
    [orderId]
  );

  if (rows.length === 0) {
    return 0;
  }

  const elapsedMinutes = rows[0].elapsed_minutes;
  const remainingMinutes = ORDER_TIMEOUT_MINUTES - elapsedMinutes;
  
  return Math.max(0, remainingMinutes);
}

