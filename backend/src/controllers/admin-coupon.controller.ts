/**
 * 管理员优惠券控制器
 */
import { Response } from 'express';
import { AdminAuthRequest } from '../middleware/admin-auth';
import { CouponModel, CouponType, CouponStatus } from '../models/coupon.model';

export class AdminCouponController {
  /**
   * 创建优惠券
   */
  static async createCoupon(req: AdminAuthRequest, res: Response) {
    try {
      const {
        code,
        name,
        description,
        type,
        discount_value,
        min_amount,
        max_discount,
        total_quantity,
        per_user_limit,
        start_time,
        end_time,
      } = req.body;

      // 验证必填字段
      if (
        !code ||
        !name ||
        !type ||
        !discount_value ||
        !total_quantity ||
        !start_time ||
        !end_time
      ) {
        return res.status(400).json({
          success: false,
          message: '参数不完整',
        });
      }

      // 验证优惠券类型
      if (![CouponType.FULL_REDUCTION, CouponType.DISCOUNT, CouponType.NO_THRESHOLD].includes(type)) {
        return res.status(400).json({
          success: false,
          message: '优惠券类型无效',
        });
      }

      // 检查代码是否已存在
      const existingCoupon = await CouponModel.findByCode(code);
      if (existingCoupon) {
        return res.status(400).json({
          success: false,
          message: '优惠券代码已存在',
        });
      }

      const couponId = await CouponModel.create({
        code,
        name,
        description,
        type,
        discount_value,
        min_amount: min_amount || 0,
        max_discount,
        total_quantity,
        remain_quantity: total_quantity,
        per_user_limit: per_user_limit || 1,
        start_time: new Date(start_time),
        end_time: new Date(end_time),
        status: CouponStatus.ENABLED,
      });

      res.json({
        success: true,
        message: '优惠券创建成功',
        data: { coupon_id: couponId },
      });
    } catch (error) {
      console.error('创建优惠券失败:', error);
      res.status(500).json({
        success: false,
        message: '创建优惠券失败',
      });
    }
  }

  /**
   * 获取优惠券列表
   */
  static async getCouponList(req: AdminAuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const page_size = parseInt(req.query.page_size as string) || 20;
      const status = req.query.status
        ? parseInt(req.query.status as string)
        : undefined;

      const result = await CouponModel.getList({
        status,
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
  static async getCouponDetail(req: AdminAuthRequest, res: Response) {
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
   * 更新优惠券状态
   */
  static async updateCouponStatus(req: AdminAuthRequest, res: Response) {
    try {
      const couponId = parseInt(req.params.id);
      const { status } = req.body;

      if (![CouponStatus.DISABLED, CouponStatus.ENABLED].includes(status)) {
        return res.status(400).json({
          success: false,
          message: '状态无效',
        });
      }

      // TODO: 实现更新状态的逻辑
      // await CouponModel.updateStatus(couponId, status);

      res.json({
        success: true,
        message: '更新成功',
      });
    } catch (error) {
      console.error('更新优惠券状态失败:', error);
      res.status(500).json({
        success: false,
        message: '更新优惠券状态失败',
      });
    }
  }
}

