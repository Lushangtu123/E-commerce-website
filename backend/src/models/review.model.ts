import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

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
    const result = await query<ResultSetHeader>(
      `INSERT INTO reviews (product_id, user_id, order_id, rating, content, images)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [productId, userId, orderId, rating, content, JSON.stringify(images)]
    );
    return result.insertId;
  }

  // 获取商品评论列表
  static async listByProduct(productId: number, page: number = 1, limit: number = 10): Promise<{ reviews: Review[], total: number }> {
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
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [productId, limit, offset]
    );

    return { reviews, total };
  }

  // 获取用户评论列表
  static async listByUser(userId: number, page: number = 1, limit: number = 10): Promise<{ reviews: Review[], total: number }> {
    const offset = (page - 1) * limit;

    const countResult = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM reviews WHERE user_id = ?',
      [userId]
    );
    const total = countResult[0].total;

    const reviews = await query<(Review & RowDataPacket)[]>(
      `SELECT r.*, p.title as product_title, p.main_image as product_image
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.product_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    return { reviews, total };
  }

  // 检查用户是否已评论该订单的商品
  static async hasReviewed(userId: number, orderId: number, productId: number): Promise<boolean> {
    const result = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM reviews WHERE user_id = ? AND order_id = ? AND product_id = ?',
      [userId, orderId, productId]
    );
    return result[0].count > 0;
  }
}

