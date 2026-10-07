import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import { OrderStatus } from '../models/order.model';
import { transitionOrder, invalidateOrderProductCache, OrderError } from '../services/order.service';
import { logAdminAction } from './admin-log.controller';
import logger from '../utils/logger';

// 获取订单列表（管理员）
export const getAdminOrders = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    
    const { orderNo, userId, status, startDate, endDate } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (orderNo) {
      whereClause += ' AND o.order_no LIKE ?';
      params.push(`%${orderNo}%`);
    }
    if (userId) {
      whereClause += ' AND o.user_id = ?';
      params.push(userId);
    }
    if (status !== undefined) {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }
    if (startDate) {
      whereClause += ' AND DATE(o.created_at) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND DATE(o.created_at) <= ?';
      params.push(endDate);
    }

    const [orders] = await pool.query(
      `SELECT 
        o.*,
        u.username,
        u.email,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) as item_count
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.user_id
       WHERE ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
      params
    );

    const total = (countResult as any[])[0].total;

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error({ err: error }, '获取订单列表失败');
    res.status(500).json({ error: '获取订单列表失败' });
  }
};

// 获取订单详情（管理员）
export const getAdminOrderDetail = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { orderId } = req.params;

    // 获取订单基本信息
    const [orders] = await pool.query(
      `SELECT 
        o.*,
        u.username,
        u.email,
        u.phone
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.user_id
       WHERE o.order_id = ?`,
      [orderId]
    );

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }

    // 获取订单商品列表
    const [items] = await pool.query(
      `SELECT 
        oi.*,
        p.title,
        p.main_image
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.product_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const order = orders[0] as any;
    const address = order.shipping_address_snapshot;
    res.json({
      order: {
        ...order,
        // Retain the existing admin fields, sourced only from the immutable snapshot.
        receiver_name: address?.receiver_name ?? null,
        recipient_phone: address?.phone ?? null,
        province: address?.province ?? null,
        city: address?.city ?? null,
        district: address?.district ?? null,
        detail_address: address?.detail_address ?? null,
      },
      items
    });
  } catch (error) {
    logger.error({ err: error }, '获取订单详情失败');
    res.status(500).json({ error: '获取订单详情失败' });
  }
};

// 更新订单状态
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status, shipping_company, tracking_number } = req.body;

    if (status === undefined) {
      return res.status(400).json({ error: '状态不能为空' });
    }

    const result = await transitionOrder(Number(orderId), status as OrderStatus, {
      shipment: status === OrderStatus.SHIPPED ? { shipping_company, tracking_number } : undefined,
    });
    await invalidateOrderProductCache(result.productIds);
    const statusText = ['待支付', '已支付', '已发货', '已完成', '已取消'][status];

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'UPDATE_ORDER_STATUS',
      'order',
      orderId as string,
      `更新订单状态: ${result.orderNo} -> ${statusText}`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: '更新成功', status });
  } catch (error) {
    if (error instanceof OrderError) return res.status(error.statusCode).json({ error: error.message });
    logger.error({ err: error }, '更新订单状态失败');
    res.status(500).json({ error: '更新失败' });
  }
};

// 获取订单统计
export const getOrderStatistics = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { startDate, endDate } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (startDate) {
      whereClause += ' AND DATE(created_at) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND DATE(created_at) <= ?';
      params.push(endDate);
    }

    // 订单统计
    const [stats] = await pool.query(
      `SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as pending_payment,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as paid,
        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as shipped,
        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) as cancelled,
        SUM(total_amount) as total_revenue,
        AVG(total_amount) as avg_order_value
       FROM orders
       WHERE ${whereClause}`,
      params
    );

    res.json(stats[0]);
  } catch (error) {
    logger.error({ err: error }, '获取订单统计失败');
    res.status(500).json({ error: '获取统计失败' });
  }
};
