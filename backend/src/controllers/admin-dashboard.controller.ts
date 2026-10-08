import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import logger from '../utils/logger';
import { AdminQueryError, adminEmptyQuerySchema, adminRecentOrdersQuerySchema, adminSalesTrendQuerySchema, adminTopProductsQuerySchema, parseAdminQuery } from '../utils/admin-query-validation';

// 获取仪表盘统计数据
export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    parseAdminQuery(req.query, adminEmptyQuerySchema);
    const pool = getPool();
    const today = new Date().toISOString().split('T')[0];

    // 今日订单数和销售额
    const [orderStats] = await pool.query(
      `SELECT 
        COUNT(*) as today_orders,
        COALESCE(SUM(CASE WHEN status IN (1,2,3) THEN total_amount ELSE 0 END), 0) as today_revenue
       FROM orders 
       WHERE DATE(created_at) = ?`,
      [today]
    );

    // 今日新用户
    const [userStats] = await pool.query(
      `SELECT COUNT(*) as new_users
       FROM users 
       WHERE DATE(created_at) = ?`,
      [today]
    );

    // 待处理订单
    const [pendingOrders] = await pool.query(
      `SELECT COUNT(*) as pending_orders
       FROM orders 
       WHERE status IN (1, 2)` // 待支付、已支付
    );

    // 商品总数
    const [productStats] = await pool.query(
      `SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_products
       FROM products`
    );

    // 昨日数据（用于计算增长率）
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const [yesterdayStats] = await pool.query(
      `SELECT 
        COUNT(*) as yesterday_orders,
        COALESCE(SUM(CASE WHEN status IN (1,2,3) THEN total_amount ELSE 0 END), 0) as yesterday_revenue
       FROM orders 
       WHERE DATE(created_at) = ?`,
      [yesterday]
    );

    const stats = orderStats[0] as any;
    const users = userStats[0] as any;
    const pending = pendingOrders[0] as any;
    const products = productStats[0] as any;
    const yesterday_data = yesterdayStats[0] as any;

    // 计算增长率
    const orderGrowth = yesterday_data.yesterday_orders > 0 
      ? ((stats.today_orders - yesterday_data.yesterday_orders) / yesterday_data.yesterday_orders * 100).toFixed(1)
      : 0;
    
    const revenueGrowth = yesterday_data.yesterday_revenue > 0
      ? ((stats.today_revenue - yesterday_data.yesterday_revenue) / yesterday_data.yesterday_revenue * 100).toFixed(1)
      : 0;

    res.json({
      today_orders: stats.today_orders,
      today_revenue: parseFloat(stats.today_revenue),
      new_users: users.new_users,
      pending_orders: pending.pending_orders,
      total_products: products.total_products,
      active_products: products.active_products,
      order_growth: parseFloat(orderGrowth.toString()),
      revenue_growth: parseFloat(revenueGrowth.toString())
    });
  } catch (error) {
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取仪表盘数据失败');
    res.status(500).json({ error: '获取数据失败' });
  }
};

// 获取最近订单
export const getRecentOrders = async (req: Request, res: Response) => {
  try {
    const {limit} = parseAdminQuery(req.query, adminRecentOrdersQuerySchema);
    const pool = getPool();

    const [orders] = await pool.query(
      `SELECT 
        o.order_id,
        o.order_no,
        o.user_id,
        u.username,
        o.total_amount,
        o.status,
        o.created_at
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.user_id
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [limit]
    );

    res.json(orders);
  } catch (error) {
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取最近订单失败');
    res.status(500).json({ error: '获取订单失败' });
  }
};

// 获取热门商品
export const getTopProducts = async (req: Request, res: Response) => {
  try {
    const {days, limit} = parseAdminQuery(req.query, adminTopProductsQuerySchema);
    const pool = getPool();

    const [products] = await pool.query(
      `SELECT 
        p.product_id,
        p.title,
        p.title_en,
        p.price,
        p.main_image,
        COUNT(DISTINCT oi.order_id) as order_count,
        SUM(oi.quantity) as total_sales,
        SUM(oi.quantity * oi.price) as total_revenue
       FROM products p
       LEFT JOIN order_items oi ON p.product_id = oi.product_id
       LEFT JOIN orders o ON oi.order_id = o.order_id
       WHERE o.status IN (1,2,3) AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY p.product_id
       ORDER BY total_sales DESC
       LIMIT ?`,
      [days, limit]
    );

    res.json(products);
  } catch (error) {
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取热门商品失败');
    res.status(500).json({ error: '获取商品失败' });
  }
};

// 获取销售趋势
export const getSalesTrend = async (req: Request, res: Response) => {
  try {
    const {days} = parseAdminQuery(req.query, adminSalesTrendQuerySchema);
    const pool = getPool();

    const [trend] = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as order_count,
        COALESCE(SUM(CASE WHEN status IN (1,2,3) THEN total_amount ELSE 0 END), 0) as revenue
       FROM orders
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [days]
    );

    res.json(trend);
  } catch (error) {
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取销售趋势失败');
    res.status(500).json({ error: '获取趋势失败' });
  }
};
