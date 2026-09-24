import { Router } from 'express';
import { ReviewController } from '../controllers/review.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/**
 * @openapi
 * /api/reviews/product/{id}:
 *   get:
 *     tags: [评论]
 *     summary: 获取商品评论列表
 *     description: 公开接口，无需登录
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *         description: 商品 ID
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: 评论列表（分页）
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Review' }
 */
router.get('/product/:id', ReviewController.listByProduct);

// 以下接口需要登录
router.use(authMiddleware);

/**
 * @openapi
 * /api/reviews:
 *   post:
 *     tags: [评论]
 *     summary: 创建评论
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, order_id, rating, content]
 *             properties:
 *               product_id: { type: integer }
 *               order_id: { type: integer, description: 关联订单 ID（需已完成） }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               content: { type: string }
 *               images:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: 评论成功
 *       400:
 *         description: 参数错误 / 订单状态不允许评论
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/', ReviewController.create);

/**
 * @openapi
 * /api/reviews/my:
 *   get:
 *     tags: [评论]
 *     summary: 获取我的评论列表
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: 我的评论列表（分页）
 */
router.get('/my', ReviewController.listByUser);

export default router;
