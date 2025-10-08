import { Router } from 'express';
import { ReviewController } from '../controllers/review.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 获取商品评论列表（无需登录）
router.get('/product/:id', ReviewController.listByProduct);

// 以下接口需要登录
router.use(authMiddleware);

// 创建评论
router.post('/', ReviewController.create);

// 获取我的评论列表
router.get('/my', ReviewController.listByUser);

export default router;

