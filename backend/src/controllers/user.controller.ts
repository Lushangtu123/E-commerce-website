import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserModel } from '../models/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';
import { normalizeRegistration, normalizeLogin, normalizeProfile, publicUser, UserValidationError } from '../utils/user-validation';

export class UserController {
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
        { userId, username, email },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.status(201).json({
        message: '注册成功',
        token,
        user: { user_id: userId, username, email }
      });
    } catch (error) {
      if (error instanceof UserValidationError) return res.status(error.statusCode).json({ error: error.message });
      if ((error as any)?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '用户名或邮箱已被使用' });
      logger.error({ err: error }, '注册失败');
      res.status(500).json({ error: '注册失败' });
    }
  }

  // 登录
  static async login(req: AuthRequest, res: Response) {
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

      // 生成token
      // @ts-ignore
      const token = jwt.sign(
        { userId: user.user_id, username: user.username, email: user.email },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.json({
        message: '登录成功',
        token,
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
