/**
 * 优惠券路由
 */
import express from 'express';
import { CouponController } from '../controllers/coupon.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

/**
 * @openapi
 * /api/coupons/available:
 *   get:
 *     tags: [优惠券]
 *     summary: 获取可领取的优惠券列表
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: page_size
 *         in: query
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: 可领取优惠券列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Coupon' }
 */
router.get('/available', authMiddleware, CouponController.getAvailableCoupons);

/**
 * @openapi
 * /api/coupons/{id}:
 *   get:
 *     tags: [优惠券]
 *     summary: 获取优惠券详情
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 优惠券详情
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Coupon' }
 *       404:
 *         description: 优惠券不存在
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id', authMiddleware, CouponController.getCouponDetail);

/**
 * @openapi
 * /api/coupons/receive:
 *   post:
 *     tags: [优惠券]
 *     summary: 领取优惠券
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               coupon_id: { type: integer, description: 优惠券 ID（与 code 二选一） }
 *               code: { type: string, description: 优惠券代码（与 coupon_id 二选一） }
 *     responses:
 *       200:
 *         description: 领取成功
 *       400:
 *         description: 已领取 / 已领完 / 不在领取时间
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/receive', authMiddleware, CouponController.receiveCoupon);

/**
 * @openapi
 * /api/coupons/my/list:
 *   get:
 *     tags: [优惠券]
 *     summary: 获取用户的优惠券列表
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: status
 *         in: query
 *         schema: { type: integer }
 *         description: 按使用状态筛选（未使用/已使用/已过期）
 *     responses:
 *       200:
 *         description: 用户优惠券列表
 */
router.get('/my/list', authMiddleware, CouponController.getUserCoupons);

/**
 * @openapi
 * /api/coupons/my/available-for-order:
 *   get:
 *     tags: [优惠券]
 *     summary: 获取可用于订单的优惠券
 *     description: 下单页根据订单金额筛选可用券
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: amount
 *         in: query
 *         required: true
 *         schema: { type: number }
 *         description: 订单金额
 *     responses:
 *       200:
 *         description: 可用优惠券列表
 */
router.get('/my/available-for-order', authMiddleware, CouponController.getAvailableForOrder);

/**
 * @openapi
 * /api/coupons/calculate:
 *   post:
 *     tags: [优惠券]
 *     summary: 计算优惠金额
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [order_amount, user_coupon_id]
 *             properties:
 *               order_amount: { type: number }
 *               user_coupon_id: { type: integer, description: 用户领取的优惠券 ID }
 *     responses:
 *       200:
 *         description: 返回优惠金额与实付金额
 */
router.post('/calculate', authMiddleware, CouponController.calculateDiscount);

export default router;
