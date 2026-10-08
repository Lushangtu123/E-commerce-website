import { getPool, query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { OrderStatus } from './order.model';
import { ReviewError, assertReviewId, assertReviewPage, parseReviewInput } from '../utils/review-validation';
import logger from '../utils/logger';

export { ReviewError } from '../utils/review-validation';

export interface Review {
  review_id: number;
  product_id: number;
  user_id: number;
  order_id: number;
  rating: number;
  content?: string;
  images?: string[];
  created_at: Date;
  // 关联用户信息
  username?: string;
  avatar_url?: string;
  product_title?: string | null;
  product_title_en?: string | null;
}

export class ReviewModel {
  // 创建评论
  static async create(
    productId: number,
    userId: number,
    orderId: number,
    rating: number,
    content?: string,
    images?: string[]
  ): Promise<number> {
    assertReviewId(userId);
    const input = parseReviewInput({ product_id: productId, order_id: orderId, rating, content, images });
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      // Serialize every review of this purchase, including older databases
      // that do not yet have the unique (order_id, product_id) index.
      const [orders] = await connection.execute<RowDataPacket[]>(
        'SELECT order_id, user_id, status FROM orders WHERE order_id = ? FOR UPDATE', [input.order_id]
      );
      const order = orders[0];
      if (!order) throw new ReviewError('订单不存在', 404);
      if (Number(order.user_id) !== userId) throw new ReviewError('无权评论该订单', 403);
      if (Number(order.status) !== OrderStatus.COMPLETED) throw new ReviewError('订单未完成，不能评论');

      const [items] = await connection.execute<RowDataPacket[]>(
        'SELECT item_id FROM order_items WHERE order_id = ? AND product_id = ? LIMIT 1',
        [input.order_id, input.product_id]
      );
      if (!items.length) throw new ReviewError('该商品不属于此订单');
      // The order lock serializes this purchase. Its first consistent read above occurs
      // after that lock, so this snapshot includes the previous writer's commit.
      // Never gap-lock a missing receipt: unrelated orders must be able to insert.
      const [reviews] = await connection.execute<RowDataPacket[]>(
        'SELECT review_id FROM reviews WHERE order_id = ? AND product_id = ? LIMIT 1',
        [input.order_id, input.product_id]
      );
      if (reviews.length) throw new ReviewError('评论已存在，请勿重复提交', 409);

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO reviews (product_id, user_id, order_id, rating, content, images)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.product_id, userId, input.order_id, input.rating, input.content ?? null,
          input.images === undefined ? null : JSON.stringify(input.images)]
      );
      await connection.commit();
      return result.insertId;
    } catch (error: any) {
      try { await connection.rollback(); }
      catch (rollbackError) { logger.error({ err: rollbackError }, '评论事务回滚失败'); }
      if (error?.code === 'ER_DUP_ENTRY') throw new ReviewError('评论已存在，请勿重复提交', 409);
      throw error;
    } finally {
      connection.release();
    }
  }

  // 获取商品评论列表
  static async listByProduct(productId: number, page: number = 1, limit: number = 10): Promise<{ reviews: Review[], total: number }> {
    assertReviewPage(productId, page, limit);
    const offset = (page - 1) * limit;

    // 获取总数
    const countResult = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM reviews WHERE product_id = ?',
      [productId]
    );
    const total = countResult[0].total;

    // 获取评论列表
    const reviews = await query<(Review & RowDataPacket)[]>(
      `SELECT r.*, u.username, u.avatar_url
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.user_id
       WHERE r.product_id = ?
       ORDER BY r.created_at DESC, r.review_id DESC
       LIMIT ? OFFSET ?`,
      [productId, limit, offset]
    );

    return { reviews, total };
  }

  // 获取用户评论列表
  static async listByUser(userId: number, page: number = 1, limit: number = 10, orderId?: number): Promise<{ reviews: Review[], total: number }> {
    assertReviewPage(userId, page, limit);
    if (orderId !== undefined) assertReviewId(orderId);
    const offset = (page - 1) * limit;
    const identity = orderId === undefined ? [userId] : [userId, orderId];

    const countResult = await query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM reviews WHERE user_id = ?${orderId === undefined ? '' : ' AND order_id = ?'}`,
      identity
    );
    const total = countResult[0].total;

    const reviews = await query<(Review & RowDataPacket)[]>(
      `SELECT r.*, p.title as product_title, p.title_en as product_title_en, p.main_image as product_image
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.product_id
       WHERE r.user_id = ?${orderId === undefined ? '' : ' AND r.order_id = ?'}
       ORDER BY r.created_at DESC, r.review_id DESC
       LIMIT ? OFFSET ?`,
      [...identity, limit, offset]
    );

    return { reviews, total };
  }

  // 检查用户是否已评论该订单的商品
  static async hasReviewed(userId: number, orderId: number, productId: number): Promise<boolean> {
    assertReviewId(userId); assertReviewId(orderId); assertReviewId(productId);
    const result = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM reviews WHERE user_id = ? AND order_id = ? AND product_id = ?',
      [userId, orderId, productId]
    );
    return result[0].count > 0;
  }
}
