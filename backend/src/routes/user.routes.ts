import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth';
import { authLimiter } from '../middleware/rate-limit';

const router = Router();

// 注册（防刷）
router.post('/register', authLimiter, UserController.register);

// 登录（防暴力破解）
router.post('/login', authLimiter, UserController.login);

// 获取个人信息（需要登录）
router.get('/profile', authMiddleware, UserController.getProfile);

// 更新个人信息（需要登录）
router.put('/profile', authMiddleware, UserController.updateProfile);

export default router;

