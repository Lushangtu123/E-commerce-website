import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

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
}

export class FavoriteModel {
  // 添加收藏
  static async add(userId: number, productId: number): Promise<number> {
    try {
      const result = await query<ResultSetHeader>(
        'INSERT INTO favorites (user_id, product_id) VALUES (?, ?)',
        [userId, productId]
      );
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
    const result = await query<ResultSetHeader>(
      'DELETE FROM favorites WHERE user_id = ? AND product_id = ?',
      [userId, productId]
    );
    return result.affectedRows > 0;
  }

  // 检查是否已收藏
  static async isFavorited(userId: number, productId: number): Promise<boolean> {
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
    const offset = (page - 1) * limit;

    // 获取收藏列表
    const favorites = await query<(FavoriteWithProduct & RowDataPacket)[]>(
      `SELECT 
        f.favorite_id,
        f.user_id,
        f.product_id,
        f.created_at,
        p.title,
        p.price,
        p.original_price,
        p.main_image,
        p.stock,
        p.status
      FROM favorites f
      LEFT JOIN products p ON f.product_id = p.product_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    // 获取总数
    const [countResult] = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?',
      [userId]
    );

    return {
      favorites,
      total: countResult.total
    };
  }

  // 批量检查收藏状态
  static async checkMultipleFavorites(
    userId: number,
    productIds: number[]
  ): Promise<{ [key: number]: boolean }> {
    if (productIds.length === 0) return {};

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
    const [result] = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM favorites WHERE user_id = ?',
      [userId]
    );
    return result.count;
  }

  // 获取商品被收藏次数
  static async getProductFavoriteCount(productId: number): Promise<number> {
    const [result] = await query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM favorites WHERE product_id = ?',
      [productId]
    );
    return result.count;
  }
}

