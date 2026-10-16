/**
 * 个人信息导出（《个人信息保护法》第 45 条：个人有权查阅、复制其个人信息）
 *
 * 在一个只读的一致性快照中读取当前用户的全部个人信息，按主题分组返回。
 * 不导出凭据与内部安全字段：密码哈希、会话版本（auth_version）、结算/领取/创建幂等键、
 * 密码重置凭据，以及处理售后的管理员编号。
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../database/mysql';

export class PersonalDataError extends Error {
  constructor(message: string, readonly statusCode = 404) {
    super(message);
    this.name = 'PersonalDataError';
  }
}

export const PERSONAL_DATA_FORMAT_VERSION = 1;

type Rows = Record<string, unknown>[];

async function rows(conn: PoolConnection, sql: string, params: unknown[]): Promise<Rows> {
  const [result] = await conn.query<RowDataPacket[]>(sql, params);
  return result.map(row => ({ ...row }));
}

export async function exportPersonalData(userId: number) {
  const conn = await getPool().getConnection();
  try {
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [account] = await rows(conn,
      'SELECT user_id, username, email, phone, avatar_url, status, created_at, updated_at FROM users WHERE user_id = ?', [userId]);
    if (!account) throw new PersonalDataError('用户不存在');

    const addresses = await rows(conn, `SELECT address_id, receiver_name, phone, province, city, district, detail_address, is_default, created_at
      FROM shipping_addresses WHERE user_id = ? ORDER BY address_id`, [userId]);
    const orders = await rows(conn, `SELECT order_id, order_no, status, total_amount, original_amount, discount_amount, coupon_name, coupon_code,
        payment_method, shipping_company, tracking_number, shipping_address_snapshot, remark, created_at, paid_at, shipped_at, completed_at
      FROM orders WHERE user_id = ? ORDER BY order_id`, [userId]);
    const items = await rows(conn, `SELECT i.order_id, i.product_id, i.product_name, i.product_name_en, i.sku_code, i.sku_specs, i.sku_specs_en,
        i.quantity, i.price
      FROM order_items i JOIN orders o ON o.order_id = i.order_id WHERE o.user_id = ? ORDER BY i.item_id`, [userId]);
    const afterSales = await rows(conn, `SELECT o.order_no, a.type, a.reason, a.status, a.review_note, a.return_company, a.return_tracking_number,
        a.return_submitted_at, a.refund_amount, a.refund_reference, a.completion_note, a.created_at, a.updated_at, a.reviewed_at,
        a.withdrawn_at, a.completed_at
      FROM after_sales_requests a JOIN orders o ON o.order_id = a.order_id WHERE a.user_id = ? ORDER BY a.request_id`, [userId]);
    const reviews = await rows(conn, `SELECT r.product_id, p.title AS product_title, o.order_no, r.rating, r.content, r.images, r.created_at
      FROM reviews r LEFT JOIN products p ON p.product_id = r.product_id LEFT JOIN orders o ON o.order_id = r.order_id
      WHERE r.user_id = ? ORDER BY r.review_id`, [userId]);
    const favorites = await rows(conn, `SELECT f.product_id, p.title AS product_title, f.created_at
      FROM favorites f LEFT JOIN products p ON p.product_id = f.product_id WHERE f.user_id = ? ORDER BY f.favorite_id`, [userId]);
    const browseHistory = await rows(conn, `SELECT b.product_id, p.title AS product_title, b.browsed_at
      FROM browse_history b LEFT JOIN products p ON p.product_id = b.product_id WHERE b.user_id = ? ORDER BY b.id`, [userId]);
    const searchHistory = await rows(conn,
      'SELECT keyword, result_count, created_at FROM search_history WHERE user_id = ? ORDER BY id', [userId]);
    const cart = await rows(conn, `SELECT c.product_id, p.title AS product_title, c.sku_id, c.quantity, c.created_at, c.updated_at
      FROM cart c LEFT JOIN products p ON p.product_id = c.product_id WHERE c.user_id = ? ORDER BY c.cart_id`, [userId]);
    const coupons = await rows(conn, `SELECT c.name, c.code, uc.status, uc.received_at, uc.used_at, uc.expired_at, o.order_no
      FROM user_coupons uc JOIN coupons c ON c.coupon_id = uc.coupon_id LEFT JOIN orders o ON o.order_id = uc.order_id
      WHERE uc.user_id = ? ORDER BY uc.user_coupon_id`, [userId]);
    const pageVisits = await rows(conn, `SELECT page_url, referrer, ip_address, user_agent, device_type, created_at
      FROM page_visits WHERE user_id = ? ORDER BY visit_id`, [userId]);
    await conn.query('COMMIT');

    return {
      format_version: PERSONAL_DATA_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      account,
      addresses,
      orders: orders.map(({ order_id, ...order }) => ({ ...order, items: items.filter(item => item.order_id === order_id).map(({ order_id: _, ...item }) => item) })),
      after_sales: afterSales,
      reviews,
      favorites,
      browse_history: browseHistory,
      search_history: searchHistory,
      cart,
      coupons,
      page_visits: pageVisits,
    };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}
