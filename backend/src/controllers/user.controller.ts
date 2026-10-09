import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserModel } from '../models/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { CSRF_ERROR, CUSTOMER_COOKIE, clearSessionCookie, hasTrustedSessionSource, setSessionCookie } from '../utils/session-cookie';
import { normalizeRegistration, normalizeLogin, normalizeProfile, publicUser, UserValidationError } from '../utils/user-validation';
import { passwordMailConfig } from '../services/password-mail.service';
import { PasswordResetModel } from '../models/password-reset.model';
import { normalizePasswordChange, normalizePasswordForgot, normalizePasswordReset } from '../utils/password-validation';
import { createHash } from 'crypto';
import { requestPasswordRecovery } from '../services/password-recovery.service';
import { jwtSecret } from '../utils/jwt-secret';

export class UserController {
  static passwordCapabilities(_req: AuthRequest, res: Response) {
    return res.json({ passwordResetAvailable: Boolean(passwordMailConfig()), passwordMinLength: 12, passwordMaxBytes: 72 });
  }

  static async forgotPassword(req: AuthRequest, res: Response) {
    const config = passwordMailConfig();
    if (!config) return res.status(503).json({ error: '密码找回邮件服务暂未配置', code: 'PASSWORD_RESET_UNAVAILABLE' });
    try {
      const { email } = normalizePasswordForgot(req.body);
      await requestPasswordRecovery(email, config);
      return res.json({ message: '如果该邮箱已注册，我们会发送密码重置邮件，请检查收件箱。' });
    } catch (error) {
      if (error instanceof UserValidationError) return res.status(error.statusCode).json({ error: error.message });
      // Do not log request bodies, reset bearer tokens, or mail-provider responses.
      logger.error('密码找回请求处理失败');
      return res.status(503).json({ error: '密码找回暂不可用，请稍后重试' });
    }
  }

  static async changePassword(req: AuthRequest, res: Response) {
    try {
      const { currentPassword, newPassword } = normalizePasswordChange(req.body);
      const user = await UserModel.findCredentialsById(req.userId!);
      if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
      if (!await bcrypt.compare(currentPassword, user.password_hash)) return res.status(400).json({ error: '当前密码错误' });
      if (await bcrypt.compare(newPassword, user.password_hash)) return res.status(400).json({ error: '新密码不能与当前密码相同' });
      const hash = await bcrypt.hash(newPassword, 12);
      if (!await PasswordResetModel.changePassword(user.user_id, user.password_hash, hash)) return res.status(409).json({ error: '账户密码已更新，请重新登录后重试' });
      clearSessionCookie(res, CUSTOMER_COOKIE);
      return res.json({ message: '密码已修改，请重新登录', reauthenticate: true });
    } catch (error) {
      if (error instanceof UserValidationError) return res.status(error.statusCode).json({ error: error.message });
      logger.error('修改密码失败');
      return res.status(503).json({ error: '修改密码暂不可用，请稍后重试' });
    }
  }

  static async resetPassword(req: AuthRequest, res: Response) {
    if (!hasTrustedSessionSource(req)) return res.status(403).json({ error: CSRF_ERROR });
    try {
      const { token, newPassword } = normalizePasswordReset(req.body);
      const hash = await bcrypt.hash(newPassword, 12);
      const consumed = await PasswordResetModel.consume(createHash('sha256').update(token).digest('hex'), hash);
      if (!consumed) return res.status(400).json({ error: '密码重置链接无效或已过期', code: 'INVALID_RESET_TOKEN' });
      clearSessionCookie(res, CUSTOMER_COOKIE);
      return res.json({ message: '密码已重置，请重新登录', reauthenticate: true });
    } catch (error) {
      if (error instanceof UserValidationError) return res.status(error.statusCode).json({ error: error.message });
      logger.error('重置密码失败');
      return res.status(503).json({ error: '密码重置暂不可用，请稍后重试' });
    }
  }
  static async getStats(req: AuthRequest, res: Response) {
    try {
      const stats = await UserModel.getStats(req.userId!);
      if (!stats) return res.status(404).json({ error: '用户不存在' });
      return res.json({ stats });
    } catch (error) {
      logger.error({ err: error }, '获取个人统计失败');
      return res.status(500).json({ error: '获取个人统计失败' });
    }
  }

  // 注册
  static async register(req: AuthRequest, res: Response) {
    if (!hasTrustedSessionSource(req)) return res.status(403).json({ error: CSRF_ERROR });
    try {
      const { username, email, password } = normalizeRegistration(req.body);

      // 检查用户是否已存在
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({ error: '邮箱已被注册' });
      }

      const existingUsername = await UserModel.findByUsername(username);
      if (existingUsername) {
        return res.status(409).json({ error: '用户名已被使用' });
      }

      // 加密密码
      const password_hash = await bcrypt.hash(password, 10);

      // 创建用户
      const userId = await UserModel.create(username, email, password_hash);

      // 生成token
      // @ts-ignore
      const token = jwt.sign(
        { userId, username, email, type: 'user', authVersion: 0 },
        jwtSecret(),
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      // The signed token travels only in the httpOnly cookie; page scripts never see it.
      setSessionCookie(res, CUSTOMER_COOKIE, token);
      res.status(201).json({
        message: '注册成功',
        user: { user_id: userId, username, email }
      });
    } catch (error) {
      if (error instanceof UserValidationError) return res.status(error.statusCode).json({ error: error.message });
      if ((error as any)?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '用户名或邮箱已被使用' });
      logger.error({ err: error }, '注册失败');
      res.status(500).json({ error: '注册失败' });
    }
  }

  // 退出登录：清除会话 Cookie。令牌本身无状态，Bearer 客户端自行丢弃即可。
  static logout(req: AuthRequest, res: Response) {
    if (!hasTrustedSessionSource(req)) return res.status(403).json({ error: CSRF_ERROR });
    clearSessionCookie(res, CUSTOMER_COOKIE);
    return res.json({ message: '已退出登录' });
  }

  // 登录
  static async login(req: AuthRequest, res: Response) {
    if (!hasTrustedSessionSource(req)) return res.status(403).json({ error: CSRF_ERROR });
    try {
      const { email, password } = normalizeLogin(req.body);

      // 查找用户
      const user = await UserModel.findByEmail(email);
      if (!user) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }

      // 验证密码
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      if (user.status !== 1) {
        return res.status(403).json({ error: '账号已被禁用' });
      }

      // 生成token
      // @ts-ignore
      const token = jwt.sign(
        { userId: user.user_id, username: user.username, email: user.email, type: 'user', authVersion: user.auth_version ?? 0 },
        jwtSecret(),
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      // The signed token travels only in the httpOnly cookie; page scripts never see it.
      setSessionCookie(res, CUSTOMER_COOKIE, token);
      res.json({
        message: '登录成功',
        user: {
          user_id: user.user_id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          avatar_url: user.avatar_url
        }
      });
    } catch (error) {
      if (error instanceof UserValidationError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '登录失败');
      res.status(500).json({ error: '登录失败' });
    }
  }

  // 获取个人信息
  static async getProfile(req: AuthRequest, res: Response) {
    try {
      const user = await UserModel.findById(req.userId!);
      
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }

      res.json({ user: publicUser(user) });
    } catch (error) {
      logger.error({ err: error }, '获取用户信息失败');
      res.status(500).json({ error: '获取用户信息失败' });
    }
  }

  // 更新个人信息
  static async updateProfile(req: AuthRequest, res: Response) {
    try {
      const updates = normalizeProfile(req.body);
      await UserModel.update(req.userId!, updates);
      const user = await UserModel.findById(req.userId!);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      res.json({ message: '更新成功', user: publicUser(user) });
    } catch (error) {
      if (error instanceof UserValidationError) return res.status(error.statusCode).json({ error: error.message });
      if ((error as any)?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '用户名已被使用' });
      logger.error({ err: error }, '更新用户信息失败');
      res.status(500).json({ error: '更新用户信息失败' });
    }
  }
}
