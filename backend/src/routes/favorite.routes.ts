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
 *     summary: 添加收藏
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id]
 *             properties:
 *               product_id: { type: integer }
 *     responses:
 *       200:
 *         description: 收藏成功
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
 *             properties:
 *               product_id: { type: integer }
 *     responses:
 *       200:
 *         description: 返回切换后的收藏状态
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
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 取消成功
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
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 返回是否已收藏
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
 *             properties:
 *               product_ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: 每个商品的收藏状态映射
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
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: 收藏列表（分页）
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
