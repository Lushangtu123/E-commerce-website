import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getPool } from '../database/mysql';

const JWT_SECRET = process.env.JWT_SECRET || 'your-admin-secret-key';

// 扩展 Request 类型
export interface AdminAuthRequest extends Request {
  admin?: {
    adminId: number;
    username: string;
    roleId: number;
    type: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      admin?: {
        adminId: number;
        username: string;
        roleId: number;
        type: string;
      };
    }
  }
}

// 验证管理员登录
export const authenticateAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const pool = getPool();
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: '未提供认证令牌' });
    }

    // 验证 token
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    // 检查是否为管理员token
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: '无效的管理员令牌' });
    }

    // 查询管理员信息
    const [admins] = await pool.query(
      'SELECT admin_id, username, role_id, status FROM admins WHERE admin_id = ?',
      [decoded.adminId]
    );

    if (!Array.isArray(admins) || admins.length === 0) {
      return res.status(401).json({ error: '管理员不存在' });
    }

    const admin = admins[0] as any;

    // 检查账号状态
    if (admin.status === 0) {
      return res.status(403).json({ error: '账号已被禁用' });
    }

    // 将管理员信息附加到请求对象
    req.admin = {
      adminId: admin.admin_id,
      username: admin.username,
      roleId: admin.role_id,
      type: 'admin'
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: '无效的令牌' });
    }
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: '令牌已过期' });
    }
    console.error('管理员认证失败:', error);
    res.status(500).json({ error: '认证失败' });
  }
};

// 验证管理员权限
export const requirePermission = (permissionCode: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = getPool();
      if (!req.admin) {
        return res.status(401).json({ error: '未认证' });
      }

      // 查询管理员的权限
      const [permissions] = await pool.query(
        `SELECT p.permission_code
         FROM role_permissions rp
         JOIN permissions p ON rp.permission_id = p.permission_id
         WHERE rp.role_id = ?`,
        [req.admin.roleId]
      );

      const permissionCodes = (permissions as any[]).map(p => p.permission_code);

      // 超级管理员拥有所有权限
      const [roles] = await pool.query(
        'SELECT role_name FROM roles WHERE role_id = ?',
        [req.admin.roleId]
      );

      const isSuperAdmin = (roles as any[])[0]?.role_name === 'super_admin';

      if (!isSuperAdmin && !permissionCodes.includes(permissionCode)) {
        return res.status(403).json({ error: '权限不足' });
      }

      next();
    } catch (error) {
      console.error('权限验证失败:', error);
      res.status(500).json({ error: '权限验证失败' });
    }
  };
};

// 导出为 adminAuthMiddleware
export const adminAuthMiddleware = authenticateAdmin;

