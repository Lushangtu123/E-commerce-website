/**
 * 优惠券模型
 */
import { getPool } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { calculateDiscountCents, couponMoneyToCents } from '../utils/coupon-discount';
import logger from '../utils/logger';

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
  static async create(
    coupon: Partial<Coupon> & Pick<Coupon, 'code' | 'name' | 'type' | 'discount_value' | 'total_quantity' | 'start_time' | 'end_time'>
  ): Promise<number> {
    const [result] = await getPool().execute<ResultSetHeader>(
      `INSERT INTO coupons 
       (code, name, description, type, discount_value, min_amount, max_discount,
        total_quantity, remain_quantity, per_user_limit, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        coupon.code,
        coupon.name,
        coupon.description ?? null,
        coupon.type,
        coupon.discount_value,
        coupon.min_amount ?? 0,
        coupon.max_discount ?? null,
        coupon.total_quantity,
        coupon.remain_quantity ?? coupon.total_quantity,
        coupon.per_user_limit ?? 1,
        coupon.start_time,
        coupon.end_time,
        coupon.status ?? CouponStatus.ENABLED,
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
    available_only?: boolean;
    include_usage?: boolean;
  }): Promise<{ coupons: Coupon[]; total: number }> {
    const { status, page = 1, page_size = 20, available_only = false, include_usage = false } = params;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(page_size) || page_size < 1 || page_size > 100) {
      throw new RangeError('分页参数无效');
    }
    if (status !== undefined && ![0, 1].includes(status)) throw new RangeError('优惠券状态无效');
    const offset = (page - 1) * page_size;
    if (!Number.isSafeInteger(offset)) throw new RangeError('分页参数无效');

    let whereClause = 'WHERE 1=1';
    const queryParams: any[] = [];

    if (status !== undefined) {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }
    if (available_only) {
      whereClause += ' AND status = 1 AND remain_quantity > 0 AND NOW() >= start_time AND NOW() < end_time';
    }

    // 获取总数
    const [countResult] = await getPool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM coupons ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // 获取列表
    // Use escaped query parameters: some MySQL versions reject execute's numeric LIMIT bindings.
    // Only administrators need usage counts. Correlated counts use idx_coupon and
    // cannot be multiplied by repeated usage logs or by another coupon's receipts.
    const selection = include_usage ? `coupons.*,
      (SELECT COUNT(*) FROM user_coupons WHERE user_coupons.coupon_id = coupons.coupon_id) AS received_count,
      (SELECT COUNT(*) FROM user_coupons WHERE user_coupons.coupon_id = coupons.coupon_id AND status = 2) AS used_count` : '*';
    const [coupons] = await getPool().query<RowDataPacket[]>(
      `SELECT ${selection} FROM coupons ${whereClause}
       ORDER BY created_at DESC, coupon_id DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, page_size, offset]
    );

    return {
      coupons: (include_usage ? coupons.map(row => ({ ...row,
        received_count: Number(row.received_count), used_count: Number(row.used_count),
      })) : coupons) as Coupon[],
      total,
    };
  }

  /**
   * 根据ID获取优惠券
   */
  static async findById(couponId: number): Promise<Coupon | null> {
    const [rows] = await getPool().execute<RowDataPacket[]>(
      'SELECT * FROM coupons WHERE coupon_id = ?',
      [couponId]
    );
    return rows.length > 0 ? (rows[0] as Coupon) : null;
  }

  /**
   * 根据代码获取优惠券
   */
  static async findByCode(code: string): Promise<Coupon | null> {
    const [rows] = await getPool().execute<RowDataPacket[]>(
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
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(couponId) || couponId <= 0) {
      throw new RangeError('优惠券ID无效');
    }
    const connection = await getPool().getConnection();

    try {
      await connection.beginTransaction();

      // Order creation and address writes use the same user-first lock order.
      const [users] = await connection.execute<RowDataPacket[]>(
        'SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [userId]
      );
      if (!users.length) throw new Error('用户不存在');

      // 检查优惠券
      const [couponRows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM coupons 
         WHERE coupon_id = ? AND status = 1 
         AND NOW() >= start_time AND NOW() < end_time
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
      const [deduction] = await connection.execute<ResultSetHeader>(
        'UPDATE coupons SET remain_quantity = remain_quantity - 1 WHERE coupon_id = ? AND remain_quantity > 0',
        [couponId]
      );
      if (deduction.affectedRows !== 1) throw new Error('优惠券已领完');

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
    const effectiveStatus = 'CASE WHEN uc.status = 1 AND (uc.expired_at <= NOW() OR c.end_time <= NOW()) THEN 3 ELSE uc.status END';
    let whereClause = 'WHERE uc.user_id = ?';
    const queryParams: any[] = [userId];

    if (status !== undefined) {
      whereClause += ` AND (${effectiveStatus}) = ?`;
      queryParams.push(status);
    }

    const [rows] = await getPool().execute<RowDataPacket[]>(
      `SELECT 
        uc.*,
        ${effectiveStatus} AS status,
        c.code, c.name, c.description, c.type,
        c.discount_value, c.min_amount, c.max_discount,
        c.status AS coupon_status, c.start_time, c.end_time
       FROM user_coupons uc
       INNER JOIN coupons c ON uc.coupon_id = c.coupon_id
       ${whereClause}
       ORDER BY uc.received_at DESC`,
      queryParams
    );

    return rows;
  }

  /** Read-only preview; callers may use their transaction connection for a consistent quote. */
  static async getAvailableForOrder(
    userId: number,
    orderAmount: number,
    connection?: PoolConnection
  ): Promise<any[]> {
    const orderCents = couponMoneyToCents(orderAmount);
    const [rows] = await (connection ?? getPool()).execute<RowDataPacket[]>(
      `SELECT uc.*, c.code, c.name, c.description, c.type,
              c.discount_value, c.min_amount, c.max_discount,
              c.status AS coupon_status, c.start_time, c.end_time
       FROM user_coupons uc
       INNER JOIN coupons c ON uc.coupon_id = c.coupon_id
       WHERE uc.user_id = ? AND uc.status = 1 AND uc.expired_at > NOW()
         AND c.status = 1 AND NOW() >= c.start_time AND NOW() < c.end_time
       ORDER BY uc.user_coupon_id`,
      [userId]
    );
    return rows.flatMap(coupon => {
      try {
        const discountAmount = calculateDiscountCents(coupon as any, orderCents) / 100;
        if (discountAmount <= 0) return [];
        return [{ ...coupon, user_coupon_id: Number(coupon.user_coupon_id), discount_amount: discountAmount, can_use: true }];
      } catch (error) {
        // Legacy invalid rules must not block other coupons in a read-only preview.
        // The checkout transaction still validates a selected rule with the strict helper.
        if (!(error instanceof RangeError)) throw error;
        logger.warn({ err: error, coupon_id: coupon.coupon_id }, '跳过规则无效的优惠券');
        return [];
      }
    })
      .sort((left, right) => right.discount_amount - left.discount_amount || left.user_coupon_id - right.user_coupon_id);
  }

  /**
   * 使用优惠券
   */
  static async useCoupon(
    userCouponId: number,
    orderId: number
  ): Promise<void> {
    const [result] = await getPool().execute<ResultSetHeader>(
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
    return calculateDiscountCents(coupon, couponMoneyToCents(orderAmount)) / 100;
  }

  /**
   * 更新优惠券状态（启用/禁用）
   */
  static async updateStatus(couponId: number, status: CouponStatus): Promise<boolean> {
    const [result] = await getPool().execute<ResultSetHeader>(
      'UPDATE coupons SET status = ?, updated_at = NOW() WHERE coupon_id = ?',
      [status, couponId]
    );
    return result.affectedRows > 0;
  }

  /**
   * 更新过期的用户优惠券状态
   */
  static async updateExpiredCoupons(): Promise<number> {
    const [result] = await getPool().execute<ResultSetHeader>(
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
    await getPool().execute(
      `INSERT INTO coupon_usage_logs 
       (user_id, coupon_id, user_coupon_id, order_id, discount_amount, order_amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, couponId, userCouponId, orderId, discountAmount, orderAmount]
    );
  }
}
