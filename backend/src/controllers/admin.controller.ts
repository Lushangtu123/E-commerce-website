import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Admin } from '../models/admin.model';

const JWT_SECRET = process.env.JWT_SECRET || 'your-admin-secret-key';

// 管理员登录
export const adminLogin = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    // 查询管理员
    const [admins] = await pool.query(
      `SELECT a.*, r.role_name 
       FROM admins a 
       LEFT JOIN roles r ON a.role_id = r.role_id 
       WHERE a.username = ?`,
      [username]
    );

    if (!Array.isArray(admins) || admins.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const admin = admins[0] as any;

    // 检查账号状态
    if (admin.status === 0) {
      return res.status(403).json({ error: '账号已被禁用' });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成 JWT Token
    const token = jwt.sign(
      { 
        adminId: admin.admin_id, 
        username: admin.username,
        roleId: admin.role_id,
        type: 'admin'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 更新最后登录时间
    await pool.query(
      'UPDATE admins SET last_login_at = NOW() WHERE admin_id = ?',
      [admin.admin_id]
    );

    // 记录登录日志
    await logAdminAction(
      admin.admin_id,
      'LOGIN',
      null,
      null,
      '管理员登录',
      req.ip,
      req.get('user-agent')
    );

    // 返回登录信息（不返回密码）
    delete admin.password_hash;

    res.json({
      token,
      admin: {
        admin_id: admin.admin_id,
        username: admin.username,
        real_name: admin.real_name,
        email: admin.email,
        role_id: admin.role_id,
        role_name: admin.role_name,
        status: admin.status
      }
    });
  } catch (error) {
    console.error('管理员登录失败:', error);
    res.status(500).json({ error: '登录失败' });
  }
};

// 获取管理员信息
export const getAdminProfile = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const adminId = (req as any).admin.adminId;

    const [admins] = await pool.query(
      `SELECT a.admin_id, a.username, a.real_name, a.email, a.phone,
              a.role_id, r.role_name, r.description as role_description,
              a.status, a.last_login_at, a.created_at
       FROM admins a
       LEFT JOIN roles r ON a.role_id = r.role_id
       WHERE a.admin_id = ?`,
      [adminId]
    );

    if (!Array.isArray(admins) || admins.length === 0) {
      return res.status(404).json({ error: '管理员不存在' });
    }

    // 获取权限列表
    const [permissions] = await pool.query(
      `SELECT p.permission_code, p.permission_name, p.resource, p.action
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.permission_id
       WHERE rp.role_id = ?`,
      [(admins[0] as any).role_id]
    );

    res.json({
      admin: admins[0],
      permissions
    });
  } catch (error) {
    console.error('获取管理员信息失败:', error);
    res.status(500).json({ error: '获取信息失败' });
  }
};

// 获取仪表盘统计数据
export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const today = new Date().toISOString().split('T')[0];

    // 今日订单数和销售额
    const [orderStats] = await pool.query(
      `SELECT 
        COUNT(*) as today_orders,
        COALESCE(SUM(total_amount), 0) as today_revenue
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
        COALESCE(SUM(total_amount), 0) as yesterday_revenue
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
    console.error('获取仪表盘数据失败:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
};

// 获取最近订单
export const getRecentOrders = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const limit = parseInt(req.query.limit as string) || 10;

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
    console.error('获取最近订单失败:', error);
    res.status(500).json({ error: '获取订单失败' });
  }
};

// 获取热门商品
export const getTopProducts = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const days = parseInt(req.query.days as string) || 7;
    const limit = parseInt(req.query.limit as string) || 10;

    const [products] = await pool.query(
      `SELECT 
        p.product_id,
        p.title,
        p.price,
        p.main_image,
        COUNT(oi.item_id) as order_count,
        SUM(oi.quantity) as total_sales,
        SUM(oi.quantity * oi.price) as total_revenue
       FROM products p
       LEFT JOIN order_items oi ON p.product_id = oi.product_id
       LEFT JOIN orders o ON oi.order_id = o.order_id
       WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY p.product_id
       ORDER BY total_sales DESC
       LIMIT ?`,
      [days, limit]
    );

    res.json(products);
  } catch (error) {
    console.error('获取热门商品失败:', error);
    res.status(500).json({ error: '获取商品失败' });
  }
};

// 获取销售趋势
export const getSalesTrend = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const days = parseInt(req.query.days as string) || 7;

    const [trend] = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as order_count,
        SUM(total_amount) as revenue
       FROM orders
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [days]
    );

    res.json(trend);
  } catch (error) {
    console.error('获取销售趋势失败:', error);
    res.status(500).json({ error: '获取趋势失败' });
  }
};

// 记录管理员操作日志（辅助函数）
export async function logAdminAction(
  adminId: number,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  description: string,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO admin_logs (admin_id, action, resource_type, resource_id, description, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [adminId, action, resourceType, resourceId, description, ipAddress || null, userAgent || null]
    );
  } catch (error) {
    console.error('记录操作日志失败:', error);
  }
}

// 获取操作日志
export const getAdminLogs = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const { action, adminId, startDate, endDate } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (action) {
      whereClause += ' AND al.action = ?';
      params.push(action);
    }
    if (adminId) {
      whereClause += ' AND al.admin_id = ?';
      params.push(adminId);
    }
    if (startDate) {
      whereClause += ' AND DATE(al.created_at) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND DATE(al.created_at) <= ?';
      params.push(endDate);
    }

    const [logs] = await pool.query(
      `SELECT 
        al.*,
        a.username,
        a.real_name
       FROM admin_logs al
       LEFT JOIN admins a ON al.admin_id = a.admin_id
       WHERE ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM admin_logs al WHERE ${whereClause}`,
      params
    );

    const total = (countResult as any[])[0].total;

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取操作日志失败:', error);
    res.status(500).json({ error: '获取日志失败' });
  }
};

