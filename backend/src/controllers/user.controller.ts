import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserModel } from '../models/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export class UserController {
  // 注册
  static async register(req: AuthRequest, res: Response) {
    try {
      const { username, email, password } = req.body;

      // 验证
      if (!username || !email || !password) {
        return res.status(400).json({ error: '请填写完整信息' });
      }

      // 检查用户是否已存在
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: '邮箱已被注册' });
      }

      const existingUsername = await UserModel.findByUsername(username);
      if (existingUsername) {
        return res.status(400).json({ error: '用户名已被使用' });
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
      console.error('注册失败:', error);
      res.status(500).json({ error: '注册失败' });
    }
  }

  // 登录
  static async login(req: AuthRequest, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: '请填写邮箱和密码' });
      }

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
      console.error('登录失败:', error);
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

      res.json({ user });
    } catch (error) {
      console.error('获取用户信息失败:', error);
      res.status(500).json({ error: '获取用户信息失败' });
    }
  }

  // 更新个人信息
  static async updateProfile(req: AuthRequest, res: Response) {
    try {
      const { username, phone, avatar_url } = req.body;
      const updates: any = {};

      if (username) updates.username = username;
      if (phone) updates.phone = phone;
      if (avatar_url) updates.avatar_url = avatar_url;

      const success = await UserModel.update(req.userId!, updates);

      if (success) {
        res.json({ message: '更新成功' });
      } else {
        res.status(400).json({ error: '更新失败' });
      }
    } catch (error) {
      console.error('更新用户信息失败:', error);
      res.status(500).json({ error: '更新用户信息失败' });
    }
  }
}

