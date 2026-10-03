import { query } from '../database/mysql';
import { customerProducts } from './product.model';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { CustomerActivityError, assertActivityId, assertActivityPage, assertActivityBatch, activityProductDTO } from '../utils/customer-activity-validation';

export interface Favorite {
  favorite_id: number;
  user_id: number;
  product_id: number;
  created_at: Date;
}

export interface FavoriteWithProduct extends Favorite {
  title: string;
  price: number;
  original_price?: number;
  main_image?: string;
  stock: number;
  status: number;
  has_sku?: number | boolean;
}

export class FavoriteModel {
  // 添加收藏
  static async add(userId: number, productId: number): Promise<number> {
    assertActivityId(userId); assertActivityId(productId);
    try {
      const result = await query<ResultSetHeader>(
        `INSERT INTO favorites (user_id, product_id)
         SELECT ?, product_id FROM products WHERE product_id = ? AND status = 1`,
        [userId, productId]
      );
      if (result.affectedRows !== 1) throw new CustomerActivityError('商品不存在或已下架', 404);
      return result.insertId;
    } catch (error: any) {
      // 如果是重复键错误，返回0表示已存在
      if (error.code === 'ER_DUP_ENTRY') {
        return 0;
      }
      throw error;
    }
  }

  // 取消收藏
  static async remove(userId: number, productId: number): Promise<boolean> {
    assertActivityId(userId); assertActivityId(productId);
    const result = await query<ResultSetHeader>(
      'DELETE FROM favorites WHERE user_id = ? AND product_id = ?',
      [userId, productId]
    );
    return result.affectedRows > 0;
  }

  // 检查是否已收藏
  static async isFavorited(userId: number, productId: number): Promise<boolean> {
    assertActivityId(userId); assertActivityId(productId);
    const results = await query<RowDataPacket[]>(
      'SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ? LIMIT 1',
      [userId, productId]
    );
    return results.length > 0;
  }

  // 获取用户收藏列表（带商品信息）
  static async getUserFavorites(
    userId: number,
    page: number = 1,
    limit: number = 20
  ): Promise<{ favorites: FavoriteWithProduct[]; total: number }> {
    assertActivityPage(userId, page, limit);
    const offset = (page - 1) * limit;

    // 获取收藏列表
    const favorites = await query<(FavoriteWithProduct & RowDataPacket)[]>(
      `SELECT 
        f.favorite_id,
        f.user_id,
        f.product_id,
        f.created_at,
        p.product_id AS existing_product_id,
        p.title,
        p.price,
        p.original_price,
        p.main_image,
        p.stock,
        p.has_sku,
        p.status
      FROM favorites f
      LEFT JOIN (${customerProducts}) p ON f.product_id = p.product_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC, f.favorite_id DESC
      LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    // 获取总数
    const [countResult] = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?',
      [userId]
    );

    return {
      favorites: favorites.map(activityProductDTO) as FavoriteWithProduct[],
      total: countResult.total
    };
  }

  // 批量检查收藏状态
  static async checkMultipleFavorites(
    userId: number,
    productIds: number[]
  ): Promise<{ [key: number]: boolean }> {
    assertActivityId(userId); assertActivityBatch(productIds);

    const placeholders = productIds.map(() => '?').join(',');
    const results = await query<RowDataPacket[]>(
      `SELECT product_id FROM favorites 
       WHERE user_id = ? AND product_id IN (${placeholders})`,
      [userId, ...productIds]
    );

    const favoriteMap: { [key: number]: boolean } = {};
    productIds.forEach(id => {
      favoriteMap[id] = false;
    });
    results.forEach(row => {
      favoriteMap[row.product_id] = true;
    });

    return favoriteMap;
  }

  // 获取收藏数量
  static async getFavoriteCount(userId: number): Promise<number> {
    assertActivityId(userId);
    const [result] = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM favorites WHERE user_id = ?',
      [userId]
    );
    return result.count;
  }

  // 获取商品被收藏次数
  static async getProductFavoriteCount(productId: number): Promise<number> {
    assertActivityId(productId);
    const [result] = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM favorites WHERE product_id = ?',
      [productId]
    );
    return result.count;
  }
}
