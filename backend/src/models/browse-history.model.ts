import { query } from '../database/mysql';
import { customerProducts } from './product.model';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { CustomerActivityError, assertActivityId, assertActivityPage, activityProductDTO } from '../utils/customer-activity-validation';

export interface BrowseHistory {
  id: number;
  user_id: number;
  product_id: number;
  browsed_at: Date;
}

export interface BrowseHistoryWithProduct extends BrowseHistory {
  title: string;
  title_en?: string | null;
  price: number;
  main_image?: string;
  stock: number;
  status: number;
  has_sku?: number | boolean;
}

export class BrowseHistoryModel {
  // 添加浏览记录
  static async add(userId: number, productId: number): Promise<number> {
    assertActivityId(userId); assertActivityId(productId);
    const result = await query<ResultSetHeader>(
      `INSERT INTO browse_history (user_id, product_id, browsed_at)
       SELECT ?, product_id, NOW() FROM products WHERE product_id = ? AND status = 1`,
      [userId, productId]
    );
    if (result.affectedRows !== 1) throw new CustomerActivityError('商品不存在或已下架', 404);
    return result.insertId;
  }

  // 获取用户浏览历史（带商品信息）
  static async getUserHistory(
    userId: number,
    page: number = 1,
    limit: number = 20
  ): Promise<{ history: BrowseHistoryWithProduct[]; total: number }> {
    assertActivityPage(userId, page, limit);
    const offset = (page - 1) * limit;

    // 获取浏览历史（去重，只保留最新的一次）
    const history = await query<(BrowseHistoryWithProduct & RowDataPacket)[]>(
      `SELECT 
        bh.id,
        bh.user_id,
        bh.product_id,
        bh.browsed_at,
        p.product_id AS existing_product_id,
        p.title,
        p.title_en,
        p.price,
        p.main_image,
        p.stock,
        p.has_sku,
        p.status
      FROM (
        SELECT id, user_id, product_id, browsed_at,
          ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY browsed_at DESC, id DESC) AS latest_rank
        FROM browse_history
        WHERE user_id = ?
      ) bh
      LEFT JOIN (${customerProducts}) p ON bh.product_id = p.product_id
      WHERE bh.latest_rank = 1
      ORDER BY bh.browsed_at DESC, bh.id DESC
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
      history: history.map(activityProductDTO) as BrowseHistoryWithProduct[],
      total: countResult.total
    };
  }

  // 清除用户浏览历史
  static async clearUserHistory(userId: number): Promise<boolean> {
    assertActivityId(userId);
    const result = await query<ResultSetHeader>(
      'DELETE FROM browse_history WHERE user_id = ?',
      [userId]
    );
    return result.affectedRows > 0;
  }

  // 删除单条浏览记录
  static async deleteRecord(userId: number, productId: number): Promise<boolean> {
    assertActivityId(userId); assertActivityId(productId);
    const result = await query<ResultSetHeader>(
      'DELETE FROM browse_history WHERE user_id = ? AND product_id = ?',
      [userId, productId]
    );
    return result.affectedRows > 0;
  }

  // 获取最近浏览的商品ID列表（用于推荐）
  static async getRecentProductIds(userId: number, limit: number = 10): Promise<number[]> {
    assertActivityPage(userId, 1, limit);
    const results = await query<RowDataPacket[]>(
      `SELECT product_id
       FROM browse_history
       WHERE user_id = ?
       GROUP BY product_id
       ORDER BY MAX(browsed_at) DESC, product_id DESC
       LIMIT ?`,
      [userId, limit]
    );
    return results.map(r => r.product_id);
  }

  // 检查是否已浏览过某商品
  static async hasViewed(userId: number, productId: number): Promise<boolean> {
    assertActivityId(userId); assertActivityId(productId);
    const results = await query<RowDataPacket[]>(
      'SELECT 1 FROM browse_history WHERE user_id = ? AND product_id = ? LIMIT 1',
      [userId, productId]
    );
    return results.length > 0;
  }
}
