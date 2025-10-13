import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import { logAdminAction } from './admin.controller';

// 获取用户列表（管理员）
export const getAdminUsers = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    
    const { keyword, status } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (keyword) {
      whereClause += ' AND (u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const [users] = await pool.query(
      `SELECT 
        u.user_id,
        u.username,
        u.email,
        u.phone,
        u.created_at,
        u.updated_at,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id) as order_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders o WHERE o.user_id = u.user_id AND o.status IN (1,2,3,4)) as total_spent
       FROM users u
       WHERE ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM users u WHERE ${whereClause}`,
      params
    );

    const total = (countResult as any[])[0].total;

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ error: '获取用户列表失败' });
  }
};

// 获取用户详情（管理员）
export const getAdminUserDetail = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { userId } = req.params;

    // 获取用户基本信息
    const [users] = await pool.query(
      `SELECT 
        u.user_id,
        u.username,
        u.email,
        u.phone,
        u.created_at,
        u.updated_at,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id) as order_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders o WHERE o.user_id = u.user_id AND o.status IN (1,2,3,4)) as total_spent
       FROM users u
       WHERE u.user_id = ?`,
      [userId]
    );

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 获取最近订单
    const [recentOrders] = await pool.query(
      `SELECT 
        order_id,
        order_no,
        total_amount,
        status,
        created_at
       FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    // 获取收货地址
    const [addresses] = await pool.query(
      `SELECT * FROM shipping_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );

    res.json({
      user: users[0],
      recent_orders: recentOrders,
      addresses
    });
  } catch (error) {
    console.error('获取用户详情失败:', error);
    res.status(500).json({ error: '获取用户详情失败' });
  }
};

// 更新用户状态（该功能暂不可用，因为用户表没有status字段）
export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    // 由于users表没有status字段，此功能暂时不可用
    res.status(501).json({ error: '用户状态功能暂未实现，需要先在数据库中添加status字段' });
  } catch (error) {
    console.error('更新用户状态失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
};

// 获取用户统计
export const getUserStatistics = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    // 用户总数
    const [userStats] = await pool.query(
      `SELECT 
        COUNT(*) as total_users
       FROM users`
    );

    // 今日新增用户
    const [todayStats] = await pool.query(
      `SELECT COUNT(*) as new_users_today
       FROM users
       WHERE DATE(created_at) = CURDATE()`
    );

    // 最近7天新增用户趋势
    const [weeklyTrend] = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
       FROM users
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    res.json({
      ...(userStats as any[])[0],
      ...(todayStats as any[])[0],
      weekly_trend: weeklyTrend
    });
  } catch (error) {
    console.error('获取用户统计失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
};

// 获取用户的订单列表
export const getUserOrders = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [orders] = await pool.query(
      `SELECT 
        o.*,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) as item_count
       FROM orders o
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM orders WHERE user_id = ?',
      [userId]
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
    console.error('获取用户订单失败:', error);
    res.status(500).json({ error: '获取订单失败' });
  }
};

