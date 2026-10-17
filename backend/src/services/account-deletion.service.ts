/**
 * 账号注销（《个人信息保护法》第 47 条：个人撤回同意或注销账号时删除个人信息）
 *
 * 规则：
 * - 需要当前密码；有未完成的订单（待支付、已支付、已发货）或未结案的售后时不能注销。
 * - 删除：收货地址、购物车、收藏、浏览与搜索记录、未使用的优惠券、密码重置凭据、访问记录和各类重试回执。
 * - 保留：订单（含收货快照）、售后、已使用的优惠券与使用记录（《电子商务法》第 31 条，交易信息至少保存三年），
 *   以及评价内容（作者显示为“已注销用户”）。
 * - 用户行去身份化：清空邮箱、手机号、头像，用户名改为占位值，密码不可再用，禁用并递增 auth_version 使所有会话失效。
 *
 * 写入顺序与其他账户写操作一致：先锁用户行（FOR UPDATE），因此并发的下单、加购、地址等写入会排在注销之后；
 * 它们拿到锁后用 lockCustomerAccount 重新检查账号，注销已提交时返回 401，不会再写入数据。
 */
import bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../database/mysql';
import { getRedisClient } from '../database/redis';
import logger from '../utils/logger';
import { PRODUCT_HOT_CACHE_KEYS, productDetailCacheKeys } from '../utils/product-cache-keys';

export class AccountDeletionError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

/** 待支付、已支付、已发货 */
const OPEN_ORDER_STATUSES = [0, 1, 2];
/** A hash no password can match; bcrypt hashes always start with "$2". */
const UNUSABLE_PASSWORD = '!deleted';

const PERSONAL_TABLES = [
  'shipping_addresses', 'address_creation_receipts', 'cart', 'cart_add_receipts', 'favorites',
  'browse_history', 'search_history', 'password_reset_tokens', 'page_visits',
] as const;

export async function deleteAccount(userId: number, password: string): Promise<void> {
  const conn = await getPool().getConnection();
  let reviewedProducts: number[] = [];
  try {
    await conn.beginTransaction();
    const [users] = await conn.query<RowDataPacket[]>(
      'SELECT password_hash, deleted_at FROM users WHERE user_id = ? FOR UPDATE', [userId]);
    if (!users.length || users[0].deleted_at) throw new AccountDeletionError('登录已过期，请重新登录', 401);
    if (!await bcrypt.compare(password, users[0].password_hash)) throw new AccountDeletionError('密码错误');

    const [open] = await conn.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE user_id = ? AND status IN (?)) AS orders,
         (SELECT COUNT(*) FROM after_sales_requests WHERE user_id = ?
            AND (status = 'requested' OR (status = 'approved' AND completed_at IS NULL))) AS after_sales`,
      [userId, OPEN_ORDER_STATUSES, userId]);
    if (Number(open[0].orders) > 0 || Number(open[0].after_sales) > 0) {
      throw new AccountDeletionError('有未完成的订单或售后，处理完成后才能注销账号', 409);
    }

    const [reviews] = await conn.query<RowDataPacket[]>('SELECT DISTINCT product_id FROM reviews WHERE user_id = ?', [userId]);
    reviewedProducts = reviews.map(row => Number(row.product_id));

    for (const table of PERSONAL_TABLES) await conn.query(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    // Unused and expired coupons go; a coupon used on an order stays with that transaction.
    await conn.query('DELETE FROM user_coupons WHERE user_id = ? AND status <> 2', [userId]);
    await conn.query(
      `UPDATE users SET username = CONCAT('deleted_', user_id), email = CONCAT('deleted_', user_id, '@deleted.invalid'),
         phone = NULL, avatar_url = NULL, password_hash = ?, status = 0, auth_version = auth_version + 1,
         deleted_at = NOW(), updated_at = NOW()
       WHERE user_id = ?`, [UNUSABLE_PASSWORD, userId]);
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }

  // Cached product pages still show the author's name; refreshing them is best effort.
  if (reviewedProducts.length) {
    try {
      await getRedisClient().del(...reviewedProducts.flatMap(productDetailCacheKeys), ...PRODUCT_HOT_CACHE_KEYS);
    } catch (error) {
      logger.warn({ err: error }, '注销后刷新商品缓存失败');
    }
  }
}
