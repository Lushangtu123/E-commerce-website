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
 *     description: 公开接口，无需登录；page为1至2147483647，limit为1至100的十进制正整数，拒绝额外查询参数
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *         description: 商品 ID
 *       - name: page
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 2147483647, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *     responses:
 *       200:
 *         description: 评论列表（分页）
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reviews:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Review' }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 totalPages: { type: integer }
 *       400:
 *         description: 商品ID或分页参数无效
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
 *     description: 仅可评价本人已完成订单中购买的商品；同订单同商品只能评价一次，包含并发提交；拒绝额外字段和字符串数字
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, order_id, rating]
 *             additionalProperties: false
 *             properties:
 *               product_id: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *               order_id: { type: integer, minimum: 1, maximum: 9007199254740991, description: 关联订单 ID（需已完成） }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               content: { type: string, maxLength: 2000, nullable: true }
 *               images:
 *                 type: array
 *                 maxItems: 9
 *                 items: { type: string, format: uri, maxLength: 2048, description: HTTP(S)图片地址 }
 *     responses:
 *       201:
 *         description: 评论成功
 *       400:
 *         description: 参数错误 / 订单状态不允许评论
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: 未登录或用户Token无效
 *       403:
 *         description: 无权评价他人订单
 *       404:
 *         description: 订单不存在
 *       409:
 *         description: 同订单同商品的评价已存在
 */
router.post('/', ReviewController.create);

/**
 * @openapi
 * /api/reviews/my:
 *   get:
 *     tags: [评论]
 *     summary: 获取我的评论列表
 *     description: 可用order_id筛选本人某个订单的评价；page为1至2147483647，limit为1至100的十进制正整数，默认1和10；不允许指定其他用户或额外查询参数
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: order_id
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *         description: 可选订单ID，仍然只返回当前用户的评价
 *       - name: page
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 2147483647, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *     responses:
 *       200:
 *         description: 我的评论列表（分页）
 *       400:
 *         description: 分页参数无效
 *       401:
 *         description: 未登录或用户Token无效
 */
router.get('/my', ReviewController.listByUser);

export default router;
