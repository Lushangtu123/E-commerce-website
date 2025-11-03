/**
 * 优惠券控制器
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { CouponModel, CouponStatus, UserCouponStatus } from '../models/coupon.model';

export class CouponController {
  /**
   * 获取可领取的优惠券列表
   */
  static async getAvailableCoupons(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const page_size = parseInt(req.query.page_size as string) || 20;

      const result = await CouponModel.getList({
        status: CouponStatus.ENABLED,
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
      console.error('获取优惠券列表失败:', error);
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
      const couponId = parseInt(req.params.id);
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
      console.error('获取优惠券详情失败:', error);
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
      const { coupon_id, code } = req.body;

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

      if (!couponId) {
        return res.status(400).json({
          success: false,
          message: '请提供优惠券ID或代码',
        });
      }

      const userCouponId = await CouponModel.receiveCoupon(userId, couponId);

      res.json({
        success: true,
        message: '领取成功',
        data: { user_coupon_id: userCouponId },
      });
    } catch (error: any) {
      console.error('领取优惠券失败:', error);
      res.status(400).json({
        success: false,
        message: error.message || '领取优惠券失败',
      });
    }
  }

  /**
   * 获取用户的优惠券列表
   */
  static async getUserCoupons(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const status = req.query.status
        ? parseInt(req.query.status as string)
        : undefined;

      const coupons = await CouponModel.getUserCoupons(userId, status);

      res.json({
        success: true,
        data: coupons,
      });
    } catch (error) {
      console.error('获取用户优惠券失败:', error);
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
      const orderAmount = parseFloat(req.query.amount as string);

      if (!orderAmount || orderAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: '订单金额无效',
        });
      }

      // 获取用户未使用的优惠券
      const userCoupons = await CouponModel.getUserCoupons(
        userId,
        UserCouponStatus.UNUSED
      );

      // 筛选可用的优惠券并计算优惠金额
      const availableCoupons = userCoupons
        .map((uc) => {
          const coupon = {
            coupon_id: uc.coupon_id,
            type: uc.type,
            discount_value: uc.discount_value,
            min_amount: uc.min_amount,
            max_discount: uc.max_discount,
          } as any;

          const discountAmount = CouponModel.calculateDiscount(
            coupon,
            orderAmount
          );

          return {
            ...uc,
            discount_amount: discountAmount,
            can_use: discountAmount > 0,
          };
        })
        .filter((uc) => uc.can_use);

      // 按优惠金额降序排序
      availableCoupons.sort((a, b) => b.discount_amount - a.discount_amount);

      res.json({
        success: true,
        data: availableCoupons,
      });
    } catch (error) {
      console.error('获取可用优惠券失败:', error);
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
      const { user_coupon_id, order_amount } = req.body;

      if (!user_coupon_id || !order_amount) {
        return res.status(400).json({
          success: false,
          message: '参数不完整',
        });
      }

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

      if (userCoupon.status !== UserCouponStatus.UNUSED) {
        return res.status(400).json({
          success: false,
          message: '优惠券不可用',
        });
      }

      const coupon = {
        coupon_id: userCoupon.coupon_id,
        type: userCoupon.type,
        discount_value: userCoupon.discount_value,
        min_amount: userCoupon.min_amount,
        max_discount: userCoupon.max_discount,
      } as any;

      const discountAmount = CouponModel.calculateDiscount(coupon, order_amount);

      res.json({
        success: true,
        data: {
          discount_amount: discountAmount,
          final_amount: Math.max(0, order_amount - discountAmount),
        },
      });
    } catch (error) {
      console.error('计算优惠金额失败:', error);
      res.status(500).json({
        success: false,
        message: '计算优惠金额失败',
      });
    }
  }
}

