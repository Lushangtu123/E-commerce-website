/**
 * 管理员优惠券控制器
 */
import { Response } from 'express';
import { AdminAuthRequest } from '../middleware/admin-auth';
import { CouponModel, CouponStatus } from '../models/coupon.model';
import { adminCouponListSchema, couponCodeSchema, couponCreateSchema, couponIdSchema, couponStatusSchema } from '../utils/coupon-validation';
import { logAdminAction } from './admin-log.controller';
import logger from '../utils/logger';

export class AdminCouponController {
  /**
   * 创建优惠券
   */
  static async createCoupon(req: AdminAuthRequest, res: Response) {
    try {
      const { error, value } = couponCreateSchema.validate(req.body || {});
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
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
        status,
      } = value;

      // 检查代码是否已存在
      const existingCoupon = await CouponModel.findByCode(code);
      if (existingCoupon) {
        return res.status(409).json({
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
        min_amount,
        max_discount,
        total_quantity,
        remain_quantity: total_quantity,
        per_user_limit,
        start_time,
        end_time,
        status,
      });

      res.json({
        success: true,
        message: '优惠券创建成功',
        data: { coupon_id: couponId },
      });

      // 记录操作日志
      await logAdminAction(
        req.admin?.adminId || 0,
        'CREATE_COUPON',
        'coupon',
        String(couponId),
        `创建优惠券: ${name} (${code})`,
        req.ip,
        req.get('user-agent')
      );
    } catch (error) {
      // Another creator can take the code after the precheck. The unique index
      // decides ownership; report that conflict without starting failure recovery.
      if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: '优惠券代码已存在' });
      }
      logger.error({ err: error }, '创建优惠券失败');
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
      const { error, value } = adminCouponListSchema.validate(req.query);
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const { page, page_size, status } = value;

      const result = await CouponModel.getList({
        status,
        page,
        page_size,
        include_usage: true,
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
  static async getCouponDetail(req: AdminAuthRequest, res: Response) {
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

  /** A read by unique code can reconcile a creation whose response was lost. */
  static async getCouponByCode(req: AdminAuthRequest, res: Response) {
    try {
      const { error, value } = couponCodeSchema.validate(req.params);
      if (error) return res.status(400).json({ success: false, message: '优惠券代码无效' });
      const coupon = await CouponModel.findByCode(value.code);
      res.json({ success: true, data: coupon });
    } catch (error) {
      logger.error({ err: error }, '获取优惠券详情失败');
      res.status(500).json({ success: false, message: '获取优惠券详情失败' });
    }
  }

  /**
   * 更新优惠券状态
   */
  static async updateCouponStatus(req: AdminAuthRequest, res: Response) {
    try {
      const idValidation = couponIdSchema.validate(req.params);
      const statusValidation = couponStatusSchema.validate(req.body || {});
      const error = idValidation.error || statusValidation.error;
      if (error) return res.status(400).json({ success: false, message: error.details[0].message });
      const couponId = idValidation.value.id;
      const { status } = statusValidation.value;

      const coupon = await CouponModel.findById(couponId);
      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: '优惠券不存在',
        });
      }

      await CouponModel.updateStatus(couponId, status);

      // 记录操作日志
      await logAdminAction(
        req.admin?.adminId || 0,
        'UPDATE_COUPON_STATUS',
        'coupon',
        String(couponId),
        `${status === CouponStatus.ENABLED ? '启用' : '停用'}优惠券: ${coupon.name} (${coupon.code})`,
        req.ip,
        req.get('user-agent')
      );

      res.json({
        success: true,
        message: '更新成功',
      });
    } catch (error) {
      logger.error({ err: error }, '更新优惠券状态失败');
      res.status(500).json({
        success: false,
        message: '更新优惠券状态失败',
      });
    }
  }
}
