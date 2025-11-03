/**
 * 优惠券模型
 */
import { pool } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

// 优惠券类型
export enum CouponType {
  FULL_REDUCTION = 1, // 满减券
  DISCOUNT = 2, // 折扣券
  NO_THRESHOLD = 3, // 无门槛券
}

// 优惠券状态
export enum CouponStatus {
  DISABLED = 0,
  ENABLED = 1,
}

// 用户优惠券状态
export enum UserCouponStatus {
  UNUSED = 1, // 未使用
  USED = 2, // 已使用
  EXPIRED = 3, // 已过期
}

export interface Coupon {
  coupon_id: number;
  code: string;
  name: string;
  description?: string;
  type: CouponType;
  discount_value: number;
  min_amount: number;
  max_discount?: number;
  total_quantity: number;
  remain_quantity: number;
  per_user_limit: number;
  start_time: Date;
  end_time: Date;
  status: CouponStatus;
  created_at: Date;
  updated_at: Date;
}

export interface UserCoupon {
  user_coupon_id: number;
  user_id: number;
  coupon_id: number;
  status: UserCouponStatus;
  used_at?: Date;
  order_id?: number;
  received_at: Date;
  expired_at: Date;
}

export class CouponModel {
  /**
   * 创建优惠券
   */
  static async create(coupon: Partial<Coupon>): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO coupons 
       (code, name, description, type, discount_value, min_amount, max_discount,
        total_quantity, remain_quantity, per_user_limit, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        coupon.code,
        coupon.name,
        coupon.description,
        coupon.type,
        coupon.discount_value,
        coupon.min_amount || 0,
        coupon.max_discount,
        coupon.total_quantity,
        coupon.remain_quantity || coupon.total_quantity,
        coupon.per_user_limit || 1,
        coupon.start_time,
        coupon.end_time,
        coupon.status || CouponStatus.ENABLED,
      ]
    );
    return result.insertId;
  }

  /**
   * 获取优惠券列表
   */
  static async getList(params: {
    status?: CouponStatus;
    page?: number;
    page_size?: number;
  }): Promise<{ coupons: Coupon[]; total: number }> {
    const { status, page = 1, page_size = 20 } = params;
    const offset = (page - 1) * page_size;

    let whereClause = 'WHERE 1=1';
    const queryParams: any[] = [];

    if (status !== undefined) {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    // 获取总数
    const [countResult] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM coupons ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // 获取列表
    const [coupons] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM coupons ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [...queryParams, page_size, offset]
    );

    return { coupons: coupons as Coupon[], total };
  }

  /**
   * 根据ID获取优惠券
   */
  static async findById(couponId: number): Promise<Coupon | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM coupons WHERE coupon_id = ?',
      [couponId]
    );
    return rows.length > 0 ? (rows[0] as Coupon) : null;
  }

  /**
   * 根据代码获取优惠券
   */
  static async findByCode(code: string): Promise<Coupon | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM coupons WHERE code = ?',
      [code]
    );
    return rows.length > 0 ? (rows[0] as Coupon) : null;
  }

  /**
   * 领取优惠券
   */
  static async receiveCoupon(
    userId: number,
    couponId: number
  ): Promise<number> {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 检查优惠券
      const [couponRows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM coupons 
         WHERE coupon_id = ? AND status = 1 
         AND NOW() BETWEEN start_time AND end_time
         FOR UPDATE`,
        [couponId]
      );

      if (couponRows.length === 0) {
        throw new Error('优惠券不存在或已失效');
      }

      const coupon = couponRows[0] as Coupon;

      // 检查剩余数量
      if (coupon.remain_quantity <= 0) {
        throw new Error('优惠券已领完');
      }

      // 检查用户领取次数
      const [userCouponRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM user_coupons 
         WHERE user_id = ? AND coupon_id = ?`,
        [userId, couponId]
      );

      if (userCouponRows[0].count >= coupon.per_user_limit) {
        throw new Error('已达领取上限');
      }

      // 扣减剩余数量
      await connection.execute(
        'UPDATE coupons SET remain_quantity = remain_quantity - 1 WHERE coupon_id = ?',
        [couponId]
      );

      // 创建用户优惠券
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO user_coupons (user_id, coupon_id, expired_at)
         VALUES (?, ?, ?)`,
        [userId, couponId, coupon.end_time]
      );

      await connection.commit();
      return result.insertId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * 获取用户的优惠券列表
   */
  static async getUserCoupons(
    userId: number,
    status?: UserCouponStatus
  ): Promise<any[]> {
    let whereClause = 'WHERE uc.user_id = ?';
    const queryParams: any[] = [userId];

    if (status !== undefined) {
      whereClause += ' AND uc.status = ?';
      queryParams.push(status);
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 
        uc.*,
        c.code, c.name, c.description, c.type,
        c.discount_value, c.min_amount, c.max_discount
       FROM user_coupons uc
       INNER JOIN coupons c ON uc.coupon_id = c.coupon_id
       ${whereClause}
       ORDER BY uc.received_at DESC`,
      queryParams
    );

    return rows;
  }

  /**
   * 使用优惠券
   */
  static async useCoupon(
    userCouponId: number,
    orderId: number
  ): Promise<void> {
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE user_coupons 
       SET status = ?, used_at = NOW(), order_id = ?
       WHERE user_coupon_id = ? AND status = ?`,
      [UserCouponStatus.USED, orderId, userCouponId, UserCouponStatus.UNUSED]
    );

    if (result.affectedRows === 0) {
      throw new Error('优惠券不可用');
    }
  }

  /**
   * 计算优惠金额
   */
  static calculateDiscount(coupon: Coupon, orderAmount: number): number {
    // 检查最低使用金额
    if (orderAmount < coupon.min_amount) {
      return 0;
    }

    let discount = 0;

    switch (coupon.type) {
      case CouponType.FULL_REDUCTION: // 满减券
        discount = coupon.discount_value;
        break;

      case CouponType.DISCOUNT: // 折扣券
        discount = orderAmount * (1 - coupon.discount_value / 100);
        if (coupon.max_discount && discount > coupon.max_discount) {
          discount = coupon.max_discount;
        }
        break;

      case CouponType.NO_THRESHOLD: // 无门槛券
        discount = coupon.discount_value;
        break;
    }

    // 优惠金额不能超过订单金额
    return Math.min(discount, orderAmount);
  }

  /**
   * 更新过期的用户优惠券状态
   */
  static async updateExpiredCoupons(): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE user_coupons 
       SET status = ? 
       WHERE status = ? AND expired_at < NOW()`,
      [UserCouponStatus.EXPIRED, UserCouponStatus.UNUSED]
    );
    return result.affectedRows;
  }

  /**
   * 记录优惠券使用日志
   */
  static async logCouponUsage(
    userId: number,
    couponId: number,
    userCouponId: number,
    orderId: number,
    discountAmount: number,
    orderAmount: number
  ): Promise<void> {
    await pool.execute(
      `INSERT INTO coupon_usage_logs 
       (user_id, coupon_id, user_coupon_id, order_id, discount_amount, order_amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, couponId, userCouponId, orderId, discountAmount, orderAmount]
    );
  }
}

