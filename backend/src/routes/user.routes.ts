import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 注册
router.post('/register', UserController.register);

// 登录
router.post('/login', UserController.login);

// 获取个人信息（需要登录）
router.get('/profile', authMiddleware, UserController.getProfile);

// 更新个人信息（需要登录）
router.put('/profile', authMiddleware, UserController.updateProfile);

export default router;

