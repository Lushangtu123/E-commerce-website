import { getPool, query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { normalizePurchaseItems, pricePurchaseItems, PurchaseError, MAX_QUANTITY } from '../services/purchase-items.service';

export interface CartItem {
  cart_id: number;
  user_id: number;
  product_id: number;
  sku_id: number | null;
  sku_code?: string | null;
  sku_specs?: Record<string, unknown> | null;
  quantity: number;
  created_at: Date;
  updated_at: Date;
  title?: string;
  price?: number | string;
  main_image?: string;
  stock?: number;
  available?: boolean;
  unavailable_reason?: string | null;
}

export class CartModel {
  private static async write(userId: number, productId: number, quantity: number, skuId: number | undefined, add: boolean): Promise<boolean> {
    const [item] = normalizePurchaseItems([{ product_id: productId, sku_id: skuId, quantity }]);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      // Checkout and cart writes share the same parent -> SKU -> cart lock order.
      const { orderItems } = await pricePurchaseItems(connection, [item], true);
      const [existing] = await connection.execute<RowDataPacket[]>(
        'SELECT quantity FROM cart WHERE user_id = ? AND product_id = ? AND sku_key = ? FOR UPDATE',
        [userId, productId, skuId ?? 0]
      );
      const total = quantity + (add ? Number(existing[0]?.quantity || 0) : 0);
      if (!Number.isSafeInteger(total) || total > MAX_QUANTITY) throw new PurchaseError('商品数量超出范围');
      if (total > (orderItems[0].sku ?? orderItems[0].product).stock) throw new PurchaseError('商品库存不足');
      let result: ResultSetHeader;
      if (add) {
        [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO cart (user_id, product_id, sku_id, quantity) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = ?`, [userId, productId, skuId ?? null, total, total]
        );
      } else {
        [result] = await connection.execute<ResultSetHeader>(
          'UPDATE cart SET quantity = ? WHERE user_id = ? AND product_id = ? AND sku_key = ?',
          [total, userId, productId, skuId ?? 0]
        );
      }
      await connection.commit();
      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  static async add(userId: number, productId: number, quantity: number, skuId?: number): Promise<boolean> {
    return this.write(userId, productId, quantity, skuId, true);
  }

  static async list(userId: number): Promise<CartItem[]> {
    const rows = await query<(CartItem & RowDataPacket)[]>(
      `SELECT c.*, p.title, p.status AS product_status,
              CASE WHEN c.sku_id IS NULL THEN p.price ELSE s.price END AS price,
              COALESCE(NULLIF(s.image, ''), p.main_image) AS main_image,
              CASE WHEN c.sku_id IS NULL THEN p.stock ELSE s.stock END AS stock,
              s.sku_code, s.specs AS sku_specs, s.status AS sku_status,
              s.sku_id AS existing_sku_id,
              EXISTS (SELECT 1 FROM product_skus all_skus WHERE all_skus.product_id = c.product_id) AS has_sku
       FROM cart c LEFT JOIN products p ON c.product_id = p.product_id
       LEFT JOIN product_skus s ON c.sku_id = s.sku_id AND c.product_id = s.product_id
       WHERE c.user_id = ? ORDER BY c.created_at DESC, c.cart_id DESC`, [userId]
    );
    return rows.map(row => {
      const reason = row.product_status !== 1 ? '商品不存在或已下架'
        : row.sku_id == null && Number(row.has_sku) === 1 ? '请选择商品规格后重新加入购物车'
        : row.sku_id != null && (!row.existing_sku_id || row.sku_status !== 1) ? '规格不存在或已停用'
        : !Number.isSafeInteger(row.quantity) || Number(row.stock) < row.quantity ? '库存不足'
        : null;
      const { product_status, sku_status, existing_sku_id, has_sku, sku_key, ...item } = row;
      return { ...item, available: reason === null, unavailable_reason: reason };
    });
  }

  static async updateQuantity(userId: number, productId: number, quantity: number, skuId?: number): Promise<boolean> {
    if (quantity === 0) return this.remove(userId, productId, skuId);
    return this.write(userId, productId, quantity, skuId, false);
  }

  static async remove(userId: number, productId: number, skuId?: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM cart WHERE user_id = ? AND product_id = ? AND sku_key = ?', [userId, productId, skuId ?? 0]
    );
    return result.affectedRows > 0;
  }

  static async clear(userId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>('DELETE FROM cart WHERE user_id = ?', [userId]);
    return result.affectedRows > 0;
  }
}
