/**
 * 管理员优惠券路由
 */
import express from 'express';
import { AdminCouponController } from '../controllers/admin-coupon.controller';
import { adminAuthMiddleware } from '../middleware/admin-auth';

const router = express.Router();

// 所有路由都需要管理员权限
router.use(adminAuthMiddleware);

/**
 * @openapi
 * /api/admin/coupons:
 *   post:
 *     tags: [管理后台-优惠券]
 *     summary: 创建优惠券
 *     description: 操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name, type, discount_value, total_quantity, start_time, end_time]
 *             properties:
 *               code: { type: string, description: 优惠券代码（唯一） }
 *               name: { type: string }
 *               description: { type: string }
 *               type: { type: integer, description: '1 满减，2 折扣，3 无门槛' }
 *               discount_value: { type: number, description: 满减金额或折扣率 }
 *               min_amount: { type: number, description: 最低消费金额 }
 *               max_discount: { type: number, description: 最大优惠金额（折扣券） }
 *               total_quantity: { type: integer, description: 发行总量 }
 *               per_user_limit: { type: integer, description: 每人限领，默认 1 }
 *               start_time: { type: string, format: date-time }
 *               end_time: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: 创建成功，返回 coupon_id
 *       400:
 *         description: 参数不完整 / 类型无效 / 代码已存在
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/', AdminCouponController.createCoupon);

/**
 * @openapi
 * /api/admin/coupons:
 *   get:
 *     tags: [管理后台-优惠券]
 *     summary: 获取优惠券列表
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: page_size
 *         in: query
 *         schema: { type: integer, default: 20 }
 *       - name: status
 *         in: query
 *         schema: { type: integer }
 *         description: 按状态筛选
 *     responses:
 *       200:
 *         description: 优惠券列表（分页）
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Coupon' }
 */
router.get('/', AdminCouponController.getCouponList);

/**
 * @openapi
 * /api/admin/coupons/{id}:
 *   get:
 *     tags: [管理后台-优惠券]
 *     summary: 获取优惠券详情
 *     security: [{ adminAuth: [] }]
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
router.get('/:id', AdminCouponController.getCouponDetail);

/**
 * @openapi
 * /api/admin/coupons/{id}/status:
 *   put:
 *     tags: [管理后台-优惠券]
 *     summary: 更新优惠券状态
 *     description: 操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: integer, description: '1 启用，0 停用' }
 *     responses:
 *       200:
 *         description: 更新成功
 *       404:
 *         description: 优惠券不存在
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.put('/:id/status', AdminCouponController.updateCouponStatus);

export default router;
