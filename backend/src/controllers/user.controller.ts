import { Response } from 'express';
import { AuthRequest, userPayload } from '../middleware/auth';
import { UserModel } from '../models/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { CSRF_ERROR, CUSTOMER_COOKIE, clearSessionCookie, hasTrustedSessionSource, sessionToken, setSessionCookie } from '../utils/session-cookie';
import { normalizeAccountDeletion, normalizeRegistration, normalizeLogin, normalizeProfile, publicUser, UserValidationError } from '../utils/user-validation';
import { AccountDeletionError, deleteAccount } from '../services/account-deletion.service';
import { passwordMailConfig } from '../services/password-mail.service';
import { PasswordResetModel } from '../models/password-reset.model';
import { normalizePasswordChange, normalizePasswordForgot, normalizePasswordReset } from '../utils/password-validation';
import { createHash, randomUUID } from 'crypto';
import { requestPasswordRecovery } from '../services/password-recovery.service';
import { jwtSecret, verifyJwt } from '../utils/jwt-secret';
import { exportPersonalData, PersonalDataError } from '../services/personal-data.service';

interface PresentedSession { userId: number; authVersion: number; sessionId?: string; expiresAt?: number }

/** The customer a presented token signs in, if it is still a valid customer token. */
function customerSession(token: string | undefined): PresentedSession | null {
  if (!token) return null;
  try {
    const decoded = verifyJwt(token);
    return userPayload(decoded)
      ? { userId: decoded.userId, authVersion: decoded.authVersion ?? 0, sessionId: decoded.sid, expiresAt: decoded.exp }
      : null;
  } catch { return null; }
}

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
        { userId, username, email, type: 'user', authVersion: 0, sid: randomUUID() },
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

  // 退出登录：递增 auth_version，撤销该账号在所有设备上的会话（被复制的 Cookie 或 Bearer 令牌随即失效），再清除本机 Cookie。
  // 撤销失败时保留 Cookie 并返回 503，不提前宣布已退出；前端保留待清理标记，下次登录前用同一 Cookie 重试。
  static async logout(req: AuthRequest, res: Response) {
    if (!hasTrustedSessionSource(req)) return res.status(403).json({ error: CSRF_ERROR });
    const target = customerSession(sessionToken(req, CUSTOMER_COOKIE).token);
    if (target) {
      try {
        await UserModel.revokeSessions(target.userId, target.authVersion);
      } catch (error) {
        logger.error({ err: error }, '顾客会话撤销失败');
        return res.status(503).json({ error: '退出登录暂不可用，请稍后重试' });
      }
    }
    clearSessionCookie(res, CUSTOMER_COOKIE);
    return res.json({ message: '已退出登录' });
  }

  // 放弃一次未完成的登录（页面已离开、响应丢失等）：只撤销这次登录签发的会话，其他设备保持登录，再清除本机 Cookie。
  // 没有会话标识的旧令牌无法单独撤销，退回撤销该账号的全部会话，不留下可重放的令牌。失败时同退出：503 并保留 Cookie。
  static async discardSession(req: AuthRequest, res: Response) {
    if (!hasTrustedSessionSource(req)) return res.status(403).json({ error: CSRF_ERROR });
    const target = customerSession(sessionToken(req, CUSTOMER_COOKIE).token);
    if (target) {
      try {
        if (target.sessionId && target.expiresAt) await UserModel.revokeSession(target.userId, target.sessionId, target.expiresAt);
        else await UserModel.revokeSessions(target.userId, target.authVersion);
      } catch (error) {
        logger.error({ err: error }, '顾客会话撤销失败');
        return res.status(503).json({ error: '退出登录暂不可用，请稍后重试' });
      }
    }
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
        { userId: user.user_id, username: user.username, email: user.email, type: 'user', authVersion: user.auth_version ?? 0, sid: randomUUID() },
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

  // 导出个人信息（JSON 附件）
  static async exportData(req: AuthRequest, res: Response) {
    try {
      const data = await exportPersonalData(req.userId!);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="personal-data-${date}.json"`);
      res.json(data);
    } catch (error) {
      if (error instanceof PersonalDataError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '导出个人信息失败');
      res.status(500).json({ error: '导出个人信息失败，请稍后重试' });
    }
  }

  // 注销账号：去身份化并使所有登录失效
  static async deleteAccount(req: AuthRequest, res: Response) {
    try {
      const { password } = normalizeAccountDeletion(req.body);
      await deleteAccount(req.userId!, password);
      clearSessionCookie(res, CUSTOMER_COOKIE);
      return res.json({ message: '账号已注销' });
    } catch (error) {
      if (error instanceof UserValidationError || error instanceof AccountDeletionError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      logger.error({ err: error }, '注销账号失败');
      return res.status(503).json({ error: '注销账号暂不可用，请稍后重试' });
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
