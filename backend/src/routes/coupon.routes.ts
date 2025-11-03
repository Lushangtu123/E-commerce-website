/**
 * 优惠券路由
 */
import express from 'express';
import { CouponController } from '../controllers/coupon.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// 获取可领取的优惠券列表（需要登录）
router.get('/available', authMiddleware, CouponController.getAvailableCoupons);

// 获取优惠券详情（需要登录）
router.get('/:id', authMiddleware, CouponController.getCouponDetail);

// 领取优惠券（需要登录）
router.post('/receive', authMiddleware, CouponController.receiveCoupon);

// 获取用户的优惠券列表（需要登录）
router.get('/my/list', authMiddleware, CouponController.getUserCoupons);

// 获取可用于订单的优惠券（需要登录）
router.get('/my/available-for-order', authMiddleware, CouponController.getAvailableForOrder);

// 计算优惠金额（需要登录）
router.post('/calculate', authMiddleware, CouponController.calculateDiscount);

export default router;

