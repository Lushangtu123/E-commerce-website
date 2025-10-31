import { Router } from 'express';
import { RecommendationController } from '../controllers/recommendation.controller';
import { authMiddleware, optionalAuth } from '../middleware/auth';

const router = Router();

// 个性化推荐（需要登录）
router.get('/personalized', authMiddleware, RecommendationController.getPersonalized);

// 相关商品推荐（可选登录）
router.get('/related/:productId', optionalAuth, RecommendationController.getRelated);

// 猜你喜欢（可选登录）
router.get('/guess-you-like', optionalAuth, RecommendationController.getGuessYouLike);

export default router;


