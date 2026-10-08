/**
 * 优惠券控制器
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { CouponModel, CouponStatus, UserCouponStatus } from '../models/coupon.model';
import {
  couponAmountQuerySchema, couponCalculateSchema, couponIdSchema,
  couponListSchema, couponReceiveSchema, userCouponListSchema,
} from '../utils/coupon-validation';
import { couponMoneyToCents } from '../utils/coupon-discount';
import logger from '../utils/logger';
import { CouponClaimError } from '../utils/coupon-claim';

export class CouponController {
  /**
   * 获取可领取的优惠券列表
   */
  static async getAvailableCoupons(req: AuthRequest, res: Response) {
    try {
      const { error, value } = couponListSchema.validate(req.query);
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const { page, page_size } = value;

      const result = await CouponModel.getList({
        status: CouponStatus.ENABLED,
        available_only: true,
        page,
        page_size,
      });

      res.json({
        success: true,
        data: result.coupons,
        pagination: {
          page,
          page_size,
          total: result.total,
          total_pages: Math.ceil(result.total / page_size),
        },
      });
    } catch (error) {
      logger.error({ err: error }, '获取优惠券列表失败');
      res.status(500).json({
        success: false,
        message: '获取优惠券列表失败',
      });
    }
  }

  /**
   * 获取优惠券详情
   */
  static async getCouponDetail(req: AuthRequest, res: Response) {
    try {
      const { error, value } = couponIdSchema.validate(req.params);
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const couponId = value.id;
      const coupon = await CouponModel.findById(couponId);

      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: '优惠券不存在',
        });
      }

      res.json({
        success: true,
        data: coupon,
      });
    } catch (error) {
      logger.error({ err: error }, '获取优惠券详情失败');
      res.status(500).json({
        success: false,
        message: '获取优惠券详情失败',
      });
    }
  }

  /**
   * 领取优惠券
   */
  static async receiveCoupon(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { error, value } = couponReceiveSchema.validate(req.body || {});
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const { coupon_id, code, claim_key } = value;

      let couponId = coupon_id;

      // 如果提供了code，则通过code查找优惠券
      if (!couponId && code) {
        const coupon = await CouponModel.findByCode(code);
        if (!coupon) {
          return res.status(404).json({
            success: false,
            message: '优惠券代码不存在',
          });
        }
        couponId = coupon.coupon_id;
      }

      const userCouponId = claim_key === undefined ? await CouponModel.receiveCoupon(userId, couponId)
        : await CouponModel.receiveCoupon(userId, couponId, claim_key);

      res.json({
        success: true,
        message: '领取成功',
        data: { user_coupon_id: userCouponId },
      });
    } catch (error: unknown) {
      const known = error instanceof CouponClaimError || error instanceof RangeError;
      if (!known) logger.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, '领取优惠券失败');
      res.status(error instanceof CouponClaimError ? error.statusCode : known ? 400 : 500).json({
        success: false,
        message: known ? error.message : '领取优惠券失败',
      });
    }
  }

  /**
   * 获取用户的优惠券列表
   */
  static async getUserCoupons(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { error, value } = userCouponListSchema.validate(req.query);
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const { status } = value;

      const coupons = await CouponModel.getUserCoupons(userId, status);

      res.json({
        success: true,
        data: coupons,
      });
    } catch (error) {
      logger.error({ err: error }, '获取用户优惠券失败');
      res.status(500).json({
        success: false,
        message: '获取用户优惠券失败',
      });
    }
  }

  /**
   * 获取可用于订单的优惠券
   */
  static async getAvailableForOrder(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { error, value } = couponAmountQuerySchema.validate(req.query);
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const availableCoupons = await CouponModel.getAvailableForOrder(userId, value.amount);

      res.json({
        success: true,
        data: availableCoupons,
      });
    } catch (error) {
      logger.error({ err: error }, '获取可用优惠券失败');
      res.status(500).json({
        success: false,
        message: '获取可用优惠券失败',
      });
    }
  }

  /**
   * 计算优惠金额（预览）
   */
  static async calculateDiscount(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { error, value } = couponCalculateSchema.validate(req.body || {});
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const { user_coupon_id, order_amount } = value;

      // 获取用户优惠券
      const userCoupons = await CouponModel.getUserCoupons(userId);
      const userCoupon = userCoupons.find(
        (uc) => uc.user_coupon_id === user_coupon_id
      );

      if (!userCoupon) {
        return res.status(404).json({
          success: false,
          message: '优惠券不存在',
        });
      }

      const availableCoupons = await CouponModel.getAvailableForOrder(userId, order_amount);
      const availableCoupon = availableCoupons.find(uc => uc.user_coupon_id === user_coupon_id);
      if (userCoupon.status !== UserCouponStatus.UNUSED || !availableCoupon) {
        return res.status(400).json({
          success: false,
          message: '优惠券不可用',
        });
      }

      const discountAmount = availableCoupon.discount_amount;

      res.json({
        success: true,
        data: {
          discount_amount: discountAmount,
          final_amount: (couponMoneyToCents(order_amount) - couponMoneyToCents(discountAmount)) / 100,
        },
      });
    } catch (error) {
      logger.error({ err: error }, '计算优惠金额失败');
      res.status(500).json({
        success: false,
        message: '计算优惠金额失败',
      });
    }
  }
}
