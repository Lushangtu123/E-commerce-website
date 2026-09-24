import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 所有订单接口都需要登录
router.use(authMiddleware);

/**
 * @openapi
 * /api/orders:
 *   post:
 *     tags: [订单]
 *     summary: 创建订单
 *     description: 下单后通过 RabbitMQ 延迟队列在 30 分钟后检查是否超时未支付
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [product_id, quantity]
 *                   properties:
 *                     product_id: { type: integer }
 *                     quantity: { type: integer, minimum: 1 }
 *               shipping_address_id: { type: integer, description: 收货地址 ID }
 *               remark: { type: string, description: 订单备注 }
 *     responses:
 *       200:
 *         description: 创建成功，返回订单 ID
 *       400:
 *         description: 商品不存在 / 库存不足
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/', OrderController.create);

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [订单]
 *     summary: 获取订单列表
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: status
 *         in: query
 *         schema: { type: integer }
 *         description: 按订单状态筛选
 *     responses:
 *       200:
 *         description: 订单列表（分页）
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Order' }
 */
router.get('/', OrderController.list);

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [订单]
 *     summary: 获取订单详情
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 订单详情（含订单项）
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Order' }
 *       404:
 *         description: 订单不存在
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id', OrderController.getDetail);

/**
 * @openapi
 * /api/orders/{id}/cancel:
 *   post:
 *     tags: [订单]
 *     summary: 取消订单
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 取消成功
 *       400:
 *         description: 订单状态不允许取消
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/:id/cancel', OrderController.cancel);

/**
 * @openapi
 * /api/orders/{id}/pay:
 *   post:
 *     tags: [订单]
 *     summary: 支付订单
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 支付成功
 *       400:
 *         description: 订单已超时取消 / 状态不允许支付
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/:id/pay', OrderController.pay);

/**
 * @openapi
 * /api/orders/{id}/confirm:
 *   post:
 *     tags: [订单]
 *     summary: 确认收货
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 确认成功
 */
router.post('/:id/confirm', OrderController.confirm);

/**
 * @openapi
 * /api/orders/{id}/remaining-time:
 *   get:
 *     tags: [订单]
 *     summary: 获取订单剩余支付时间
 *     description: 返回待支付订单距离 30 分钟超时还剩多少秒
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 剩余秒数
 */
router.get('/:id/remaining-time', OrderController.getRemainingTime);

export default router;
