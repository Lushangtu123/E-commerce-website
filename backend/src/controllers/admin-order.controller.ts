import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import { logAdminAction } from './admin.controller';

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
    console.error('获取订单列表失败:', error);
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
        u.phone,
        sa.recipient_name,
        sa.phone as recipient_phone,
        sa.province,
        sa.city,
        sa.district,
        sa.address,
        sa.postal_code
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.user_id
       LEFT JOIN shipping_addresses sa ON o.shipping_address_id = sa.address_id
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

    res.json({
      order: orders[0],
      items
    });
  } catch (error) {
    console.error('获取订单详情失败:', error);
    res.status(500).json({ error: '获取订单详情失败' });
  }
};

// 更新订单状态
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { orderId } = req.params;
    const { status } = req.body;

    if (status === undefined) {
      return res.status(400).json({ error: '状态不能为空' });
    }

    // 获取订单信息
    const [orders] = await pool.query(
      'SELECT order_id, order_no, status FROM orders WHERE order_id = ?',
      [orderId]
    );

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }

    const order = orders[0] as any;

    // 更新状态
    await pool.query(
      'UPDATE orders SET status = ?, updated_at = NOW() WHERE order_id = ?',
      [status, orderId]
    );

    const statusText = ['待支付', '已支付', '待发货', '已发货', '已完成', '已取消'][status] || '未知';

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'UPDATE_ORDER_STATUS',
      'order',
      orderId,
      `更新订单状态: ${order.order_no} -> ${statusText}`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: '更新成功', status });
  } catch (error) {
    console.error('更新订单状态失败:', error);
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
        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as shipped,
        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 5 THEN 1 ELSE 0 END) as cancelled,
        SUM(total_amount) as total_revenue,
        AVG(total_amount) as avg_order_value
       FROM orders
       WHERE ${whereClause}`,
      params
    );

    res.json(stats[0]);
  } catch (error) {
    console.error('获取订单统计失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
};

