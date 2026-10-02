/**
 * 订单超时自动取消服务
 * 定期检查待支付订单，超时自动取消并恢复库存
 */

import { getPool } from '../database/mysql';
import { RowDataPacket } from 'mysql2';
import { OrderStatus } from '../models/order.model';
import { transitionOrder, invalidateOrderProductCache } from './order.service';
import logger from '../utils/logger';

interface PendingOrder extends RowDataPacket {
  order_id: number;
  order_no: string;
  user_id: number;
  created_at: Date;
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
  const result = await transitionOrder(orderId, OrderStatus.CANCELLED, { timeoutOnly: true });
  if (!result.changed) return false;
  await invalidateOrderProductCache(result.productIds);
  logger.info(`[订单超时] 订单 ${result.orderNo} 已自动取消，库存已恢复`);
  return true;
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
       AND created_at <= DATE_SUB(NOW(), INTERVAL 30 MINUTE)`
    );

    logger.info(`[订单超时检查] 发现 ${timeoutOrders.length} 个超时订单`);

    let successCount = 0;
    for (const order of timeoutOrders) {
      try {
        const cancelled = await cancelTimeoutOrder(order.order_id);
        if (cancelled) successCount++;
      } catch (error) {
        logger.error({ err: error }, `[订单超时] 处理订单 ${order.order_no} 失败`);
        // 继续处理下一个订单
      }
    }

    if (timeoutOrders.length > 0) {
      logger.info(`[订单超时检查] 成功处理 ${successCount} 个超时订单`);
    }
  } catch (error) {
    logger.error({ err: error }, '[订单超时检查] 查询超时订单失败');
    throw error;
  }
}

/**
 * 启动订单超时检查定时任务
 * 每5分钟执行一次
 */
export function startOrderTimeoutChecker(): NodeJS.Timeout {
  logger.info('[订单超时检查] 定时任务已启动，每5分钟检查一次');
  
  // 立即执行一次
  checkAndCancelTimeoutOrders().catch(error => {
    logger.error({ err: error }, '[订单超时检查] 初始检查失败');
  });

  // 每5分钟执行一次
  return setInterval(() => {
    checkAndCancelTimeoutOrders().catch(error => {
      logger.error({ err: error }, '[订单超时检查] 定时检查失败');
    });
  }, 5 * 60 * 1000); // 5分钟
}

/**
 * 停止订单超时检查定时任务
 */
export function stopOrderTimeoutChecker(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  logger.info('[订单超时检查] 定时任务已停止');
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
