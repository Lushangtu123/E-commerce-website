import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface BrowseHistory {
  id: number;
  user_id: number;
  product_id: number;
  browsed_at: Date;
}

export interface BrowseHistoryWithProduct extends BrowseHistory {
  title: string;
  price: number;
  main_image?: string;
  stock: number;
  status: number;
}

export class BrowseHistoryModel {
  // 添加浏览记录
  static async add(userId: number, productId: number): Promise<number> {
    const result = await query<ResultSetHeader>(
      'INSERT INTO browse_history (user_id, product_id, browsed_at) VALUES (?, ?, NOW())',
      [userId, productId]
    );
    return result.insertId;
  }

  // 获取用户浏览历史（带商品信息）
  static async getUserHistory(
    userId: number,
    page: number = 1,
    limit: number = 20
  ): Promise<{ history: BrowseHistoryWithProduct[]; total: number }> {
    const offset = (page - 1) * limit;

    // 获取浏览历史（去重，只保留最新的一次）
    const history = await query<(BrowseHistoryWithProduct & RowDataPacket)[]>(
      `SELECT 
        bh.id,
        bh.user_id,
        bh.product_id,
        bh.browsed_at,
        p.title,
        p.price,
        p.main_image,
        p.stock,
        p.status
      FROM (
        SELECT user_id, product_id, MAX(id) as id, MAX(browsed_at) as browsed_at
        FROM browse_history
        WHERE user_id = ?
        GROUP BY product_id
      ) bh_latest
      JOIN browse_history bh ON bh.id = bh_latest.id
      LEFT JOIN products p ON bh.product_id = p.product_id
      ORDER BY bh.browsed_at DESC
      LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    // 获取总数（去重后）
    const [countResult] = await query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT product_id) as total 
       FROM browse_history 
       WHERE user_id = ?`,
      [userId]
    );

    return {
      history,
      total: countResult.total
    };
  }

  // 清除用户浏览历史
  static async clearUserHistory(userId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM browse_history WHERE user_id = ?',
      [userId]
    );
    return result.affectedRows > 0;
  }

  // 删除单条浏览记录
  static async deleteRecord(userId: number, productId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM browse_history WHERE user_id = ? AND product_id = ?',
      [userId, productId]
    );
    return result.affectedRows > 0;
  }

  // 获取最近浏览的商品ID列表（用于推荐）
  static async getRecentProductIds(userId: number, limit: number = 10): Promise<number[]> {
    const results = await query<RowDataPacket[]>(
      `SELECT DISTINCT product_id
       FROM browse_history
       WHERE user_id = ?
       ORDER BY browsed_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    return results.map(r => r.product_id);
  }

  // 检查是否已浏览过某商品
  static async hasViewed(userId: number, productId: number): Promise<boolean> {
    const results = await query<RowDataPacket[]>(
      'SELECT 1 FROM browse_history WHERE user_id = ? AND product_id = ? LIMIT 1',
      [userId, productId]
    );
    return results.length > 0;
  }
}

