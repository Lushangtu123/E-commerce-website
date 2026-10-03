import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 所有订单接口都需要登录
router.use(authMiddleware);

/**
 * @openapi
 * /api/orders/preview:
 *   post:
 *     tags: [订单]
 *     summary: 预览服务器结算金额和可用优惠券
 *     description: 不占用库存或优惠券，下单时重新校验价格与优惠券状态
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
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [product_id, quantity]
 *                   properties:
 *                     product_id: { type: integer, minimum: 1 }
 *                     sku_id: { type: integer, minimum: 1, description: 规格商品必填 }
 *                     quantity: { type: integer, minimum: 1 }
 *               user_coupon_id: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: 原价、优惠额、应付金额、选中券和可用券列表
 *       400:
 *         description: 商品、数量或优惠券无效
 */
router.post('/preview', OrderController.preview);

/**
 * @openapi
 * /api/orders:
 *   post:
 *     tags: [订单]
 *     summary: 创建订单
 *     description: 必须选择本人有效地址，服务器保存收货快照。下单后通过 RabbitMQ 延迟队列在 30 分钟后检查是否超时未支付
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items, shipping_address_id]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [product_id, quantity]
 *                   properties:
 *                     product_id: { type: integer, minimum: 1 }
 *                     sku_id: { type: integer, minimum: 1, description: 规格商品必填 }
 *                     quantity: { type: integer, minimum: 1 }
 *               shipping_address_id: { type: integer, minimum: 1, description: 本人完整收货地址 ID（必填） }
 *               remark: { type: string, description: 订单备注 }
 *               user_coupon_id: { type: integer, minimum: 1, description: 用户已领取的优惠券 ID }
 *     responses:
 *       201:
 *         description: 创建成功，返回订单 ID、原价、优惠额和应付金额
 *       400:
 *         description: 商品不存在 / 库存不足 / 收货地址无效或信息不完整
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
 *     summary: 分页获取本人订单列表
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 2147483647, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *       - name: status
 *         in: query
 *         schema: { type: integer, enum: [0, 1, 2, 3, 4] }
 *         description: 待支付、已支付、已发货、已完成、已取消；省略时返回全部
 *     responses:
 *       200:
 *         description: 按创建时间、订单 ID 倒序返回；空列表 totalPages 为 0
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [orders, total, page, limit, totalPages]
 *               properties:
 *                 orders:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Order' }
 *                 total: { type: integer, minimum: 0 }
 *                 page: { type: integer, minimum: 1 }
 *                 limit: { type: integer, minimum: 1, maximum: 100 }
 *                 totalPages: { type: integer, minimum: 0 }
 *       400:
 *         description: 参数必须是上述范围内的整数字符串，不接受重复或未知参数
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
