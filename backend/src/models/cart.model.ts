import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface CartItem {
  cart_id: number;
  user_id: number;
  product_id: number;
  quantity: number;
  created_at: Date;
  updated_at: Date;
  // 关联商品信息
  title?: string;
  price?: number;
  main_image?: string;
  stock?: number;
}

export class CartModel {
  // 添加到购物车
  static async add(userId: number, productId: number, quantity: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      `INSERT INTO cart (user_id, product_id, quantity) 
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
      [userId, productId, quantity, quantity]
    );
    return result.affectedRows > 0;
  }

  // 获取购物车列表
  static async list(userId: number): Promise<CartItem[]> {
    return await query<(CartItem & RowDataPacket)[]>(
      `SELECT c.*, p.title, p.price, p.main_image, p.stock 
       FROM cart c
       LEFT JOIN products p ON c.product_id = p.product_id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`,
      [userId]
    );
  }

  // 更新数量
  static async updateQuantity(userId: number, productId: number, quantity: number): Promise<boolean> {
    if (quantity <= 0) {
      return await this.remove(userId, productId);
    }
    
    const result = await query<ResultSetHeader>(
      'UPDATE cart SET quantity = ? WHERE user_id = ? AND product_id = ?',
      [quantity, userId, productId]
    );
    return result.affectedRows > 0;
  }

  // 删除商品
  static async remove(userId: number, productId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM cart WHERE user_id = ? AND product_id = ?',
      [userId, productId]
    );
    return result.affectedRows > 0;
  }

  // 清空购物车
  static async clear(userId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM cart WHERE user_id = ?',
      [userId]
    );
    return result.affectedRows > 0;
  }

  // 批量删除
  static async removeMultiple(userId: number, productIds: number[]): Promise<boolean> {
    const placeholders = productIds.map(() => '?').join(',');
    const result = await query<ResultSetHeader>(
      `DELETE FROM cart WHERE user_id = ? AND product_id IN (${placeholders})`,
      [userId, ...productIds]
    );
    return result.affectedRows > 0;
  }
}

