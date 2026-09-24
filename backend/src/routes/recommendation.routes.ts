import { Router } from 'express';
import { RecommendationController } from '../controllers/recommendation.controller';
import { authMiddleware, optionalAuth } from '../middleware/auth';

const router = Router();

/**
 * @openapi
 * /api/recommendations/personalized:
 *   get:
 *     tags: [推荐]
 *     summary: 个性化推荐
 *     description: 基于用户浏览 / 购买行为的个性化推荐，需登录
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: 推荐商品列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Product' }
 */
router.get('/personalized', authMiddleware, RecommendationController.getPersonalized);

/**
 * @openapi
 * /api/recommendations/related/{productId}:
 *   get:
 *     tags: [推荐]
 *     summary: 相关商品推荐
 *     description: 可选登录，登录后推荐更精准
 *     parameters:
 *       - name: productId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: 相关商品列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Product' }
 */
router.get('/related/:productId', optionalAuth, RecommendationController.getRelated);

/**
 * @openapi
 * /api/recommendations/guess-you-like:
 *   get:
 *     tags: [推荐]
 *     summary: 猜你喜欢
 *     description: 可选登录，首页推荐位使用
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: 推荐商品列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Product' }
 */
router.get('/guess-you-like', optionalAuth, RecommendationController.getGuessYouLike);

export default router;
