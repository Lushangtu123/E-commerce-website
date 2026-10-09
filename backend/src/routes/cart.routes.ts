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
 *     summary: 添加到购物车（请求号可安全重试）
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id, quantity]
 *             properties:
 *               product_id: { type: integer, minimum: 1 }
 *               sku_id: { type: integer, minimum: 1, description: 规格商品必填 }
 *               quantity: { type: integer, minimum: 1 }
 *               add_key: { type: string, format: uuid, description: 可选。同一用户的相同请求只添加一次；旧请求重试不会恢复已删除的购物车行 }
 *     responses:
 *       200:
 *         description: 添加成功；带请求号时返回 add_key 和 replayed，随后 GET 读取最新购物车
 *       409:
 *         description: 请求号已用于不同的商品、规格或数量
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
 *               product_id: { type: integer, minimum: 1 }
 *               sku_id: { type: integer, minimum: 1, description: 规格商品必填 }
 *               quantity: { type: integer, minimum: 0, description: 数量为0时移除该规格 }
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
 *     summary: 删除购物车商品（省略sku_id仅删除无规格行）
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *         description: 商品 ID
 *       - name: sku_id
 *         in: query
 *         schema: { type: integer, minimum: 1 }
 *         description: 指定要删除的规格
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
