import express from 'express';
import {
  addFavorite,
  removeFavorite,
  toggleFavorite,
  checkFavorite,
  getUserFavorites,
  checkMultipleFavorites,
  getFavoriteCount
} from '../controllers/favorite.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// 所有收藏路由都需要认证
router.use(authMiddleware);

/**
 * @openapi
 * /api/favorites:
 *   post:
 *     tags: [收藏]
 *     summary: 收藏已上架的商品
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id]
 *             additionalProperties: false
 *             properties:
 *               product_id: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *     responses:
 *       200:
 *         description: 收藏成功
 *       400:
 *         description: 商品 ID 或请求体无效
 *       404:
 *         description: 商品不存在或未上架
 */
router.post('/', addFavorite);

/**
 * @openapi
 * /api/favorites/toggle:
 *   post:
 *     tags: [收藏]
 *     summary: 切换收藏状态
 *     description: 已收藏则取消，未收藏则添加
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id]
 *             additionalProperties: false
 *             properties:
 *               product_id: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *     responses:
 *       200:
 *         description: 返回切换后的收藏状态
 *       400:
 *         description: 商品 ID 或请求体无效
 *       404:
 *         description: 新增收藏的商品不存在或未上架；已有失效收藏仍可取消
 */
router.post('/toggle', toggleFavorite);

/**
 * @openapi
 * /api/favorites/{product_id}:
 *   delete:
 *     tags: [收藏]
 *     summary: 取消收藏
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: product_id
 *         in: path
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *     responses:
 *       200:
 *         description: 取消成功
 *       400:
 *         description: 商品 ID 无效
 *       404:
 *         description: 本人收藏记录不存在
 */
router.delete('/:product_id', removeFavorite);

/**
 * @openapi
 * /api/favorites/check/{product_id}:
 *   get:
 *     tags: [收藏]
 *     summary: 检查单个商品收藏状态
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: product_id
 *         in: path
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *     responses:
 *       200:
 *         description: 返回是否已收藏
 *       400:
 *         description: 商品 ID 无效
 */
router.get('/check/:product_id', checkFavorite);

/**
 * @openapi
 * /api/favorites/check-multiple:
 *   post:
 *     tags: [收藏]
 *     summary: 批量检查收藏状态
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_ids]
 *             additionalProperties: false
 *             properties:
 *               product_ids:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *                 items: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *     responses:
 *       200:
 *         description: 每个商品的收藏状态映射
 *       400:
 *         description: 商品 ID 列表或请求体无效
 */
router.post('/check-multiple', checkMultipleFavorites);

/**
 * @openapi
 * /api/favorites/my:
 *   get:
 *     tags: [收藏]
 *     summary: 获取用户收藏列表
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 2147483647, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: 本人收藏及 pagination（page、limit、total、total_pages），时间并列时按收藏 ID 倒序；缺失商品返回不可购买、可取消的占位记录
 *       400:
 *         description: 分页参数必须是范围内的规范正整数字符串，不接受重复或未知参数
 */
router.get('/my', getUserFavorites);

/**
 * @openapi
 * /api/favorites/count:
 *   get:
 *     tags: [收藏]
 *     summary: 获取收藏数量
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 收藏总数
 */
router.get('/count', getFavoriteCount);

export default router;
