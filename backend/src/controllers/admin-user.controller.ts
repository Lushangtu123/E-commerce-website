import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import { logAdminAction } from './admin-log.controller';
import logger from '../utils/logger';
import { AdminQueryError, adminEmptyQuerySchema, adminUserOrdersQuerySchema, adminUserPathId, adminUsersQuerySchema, parseAdminQuery } from '../utils/admin-query-validation';

// 获取用户列表（管理员）
export const getAdminUsers = async (req: Request, res: Response) => {
  try {
    const {page, limit, keyword, status} = parseAdminQuery(req.query, adminUsersQuerySchema);
    const pool = getPool();
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: any[] = [];

    if (keyword) {
      whereClause += ' AND (u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (status !== undefined) {
      whereClause += ' AND u.status = ?';
      params.push(status);
    }

    const [users] = await pool.query(
      `SELECT 
        u.user_id,
        u.username,
        u.email,
        u.phone,
        u.status,
        u.created_at,
        u.updated_at,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id) as order_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders o WHERE o.user_id = u.user_id AND o.status IN (1,2,3)) as total_spent
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
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取用户列表失败');
    res.status(500).json({ error: '获取用户列表失败' });
  }
};

// 获取用户详情（管理员）
export const getAdminUserDetail = async (req: Request, res: Response) => {
  try {
    const userId = adminUserPathId(req.params.userId);
    if (!userId) return res.status(400).json({error: '用户ID无效'});
    parseAdminQuery(req.query, adminEmptyQuerySchema);
    const pool = getPool();

    // 获取用户基本信息
    const [users] = await pool.query(
      `SELECT 
        u.user_id,
        u.username,
        u.email,
        u.phone,
        u.status,
        u.created_at,
        u.updated_at,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id) as order_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders o WHERE o.user_id = u.user_id AND o.status IN (1,2,3)) as total_spent
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
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取用户详情失败');
    res.status(500).json({ error: '获取用户详情失败' });
  }
};

// 更新用户状态
export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const body = req.body;
    if (typeof userId !== 'string' || !/^[1-9]\d*$/.test(userId) || !Number.isSafeInteger(Number(userId)) ||
        !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        (body.status !== 0 && body.status !== 1)) {
      return res.status(400).json({ error: '无效的状态值' });
    }
    const { status } = body;
    const pool = getPool();

    // 获取用户信息
    const [users] = await pool.query(
      'SELECT user_id, username FROM users WHERE user_id = ?',
      [userId]
    );

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const user = users[0] as any;

    // Revoke existing sessions atomically when disabling. Re-enabling retains the version,
    // so cookies and legacy Bearer tokens issued before the disable cannot become valid again.
    await pool.query(
      'UPDATE users SET auth_version = auth_version + IF(? = 0, 1, 0), status = ?, updated_at = NOW() WHERE user_id = ?',
      [status, status, userId]
    );

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'UPDATE_USER_STATUS',
      'user',
      userId as string,
      `${status === 1 ? '启用' : '禁用'}用户: ${user.username}`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: '更新成功', status });
  } catch (error) {
    logger.error({ err: error }, '更新用户状态失败');
    res.status(500).json({ error: '更新失败' });
  }
};

// 获取用户统计
export const getUserStatistics = async (req: Request, res: Response) => {
  try {
    parseAdminQuery(req.query, adminEmptyQuerySchema);
    const pool = getPool();
    // 用户总数和状态分布
    const [userStats] = await pool.query(
      `SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as inactive_users
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
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取用户统计失败');
    res.status(500).json({ error: '获取统计失败' });
  }
};

// 获取用户的订单列表
export const getUserOrders = async (req: Request, res: Response) => {
  try {
    const userId = adminUserPathId(req.params.userId);
    if (!userId) return res.status(400).json({error: '用户ID无效'});
    const {page, limit} = parseAdminQuery(req.query, adminUserOrdersQuerySchema);
    const pool = getPool();
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
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取用户订单失败');
    res.status(500).json({ error: '获取订单失败' });
  }
};
