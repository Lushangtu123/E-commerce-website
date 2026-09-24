import { Router } from 'express';
import { CartController } from '../controllers/cart.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 所有购物车接口都需要登录
router.use(authMiddleware);

/**
 * @openapi
 * /api/cart:
 *   get:
 *     tags: [购物车]
 *     summary: 获取购物车列表
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 购物车商品列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/CartItem' }
 *       401:
 *         description: 未登录
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/', CartController.list);

/**
 * @openapi
 * /api/cart:
 *   post:
 *     tags: [购物车]
 *     summary: 添加到购物车
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, quantity]
 *             properties:
 *               product_id: { type: integer }
 *               quantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: 添加成功
 *       400:
 *         description: 参数错误 / 库存不足
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/', CartController.add);

/**
 * @openapi
 * /api/cart:
 *   put:
 *     tags: [购物车]
 *     summary: 更新购物车商品数量
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, quantity]
 *             properties:
 *               product_id: { type: integer }
 *               quantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/', CartController.updateQuantity);

/**
 * @openapi
 * /api/cart/{id}:
 *   delete:
 *     tags: [购物车]
 *     summary: 删除购物车商品
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *         description: 商品 ID
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/:id', CartController.remove);

/**
 * @openapi
 * /api/cart:
 *   delete:
 *     tags: [购物车]
 *     summary: 清空购物车
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 清空成功
 */
router.delete('/', CartController.clear);

export default router;
