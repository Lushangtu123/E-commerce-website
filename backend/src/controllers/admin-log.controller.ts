import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import logger from '../utils/logger';

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
    logger.error({ err: error }, '记录操作日志失败');
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
    logger.error({ err: error }, '获取操作日志失败');
    res.status(500).json({ error: '获取日志失败' });
  }
};
