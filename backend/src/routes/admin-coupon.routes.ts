/**
 * 管理员优惠券路由
 */
import express from 'express';
import { AdminCouponController } from '../controllers/admin-coupon.controller';
import { adminAuthMiddleware } from '../middleware/admin-auth';

const router = express.Router();

// 所有路由都需要管理员权限
router.use(adminAuthMiddleware);

// 创建优惠券
router.post('/', AdminCouponController.createCoupon);

// 获取优惠券列表
router.get('/', AdminCouponController.getCouponList);

// 获取优惠券详情
router.get('/:id', AdminCouponController.getCouponDetail);

// 更新优惠券状态
router.put('/:id/status', AdminCouponController.updateCouponStatus);

export default router;

