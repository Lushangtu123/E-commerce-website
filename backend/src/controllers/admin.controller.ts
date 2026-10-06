import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Admin } from '../models/admin.model';
import logger from '../utils/logger';
import { ADMIN_COOKIE, CSRF_ERROR, clearSessionCookie, hasCsrfHeader, setSessionCookie } from '../utils/session-cookie';
import { logAdminAction } from './admin-log.controller';

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

    // The signed token travels only in the httpOnly cookie; page scripts never see it.
    setSessionCookie(res, ADMIN_COOKIE, token);
    res.json({
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
    logger.error({ err: error }, '管理员登录失败');
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
    logger.error({ err: error }, '获取管理员信息失败');
    res.status(500).json({ error: '获取信息失败' });
  }
};

// 管理员退出登录：清除会话 Cookie。即使令牌已过期也能退出，所以不经过管理员认证。
export const adminLogout = (req: Request, res: Response) => {
  if (!hasCsrfHeader(req)) return res.status(403).json({ error: CSRF_ERROR });
  clearSessionCookie(res, ADMIN_COOKIE);
  return res.json({ message: '已退出登录' });
};
