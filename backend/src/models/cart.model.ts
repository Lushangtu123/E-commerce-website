import { createHash } from 'crypto';
import { getPool, query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { normalizePurchaseItems, pricePurchaseItems, PurchaseError, MAX_QUANTITY } from '../services/purchase-items.service';
import { SpecsTranslation } from '../utils/product-i18n';

export interface CartItem {
  cart_id: number;
  user_id: number;
  product_id: number;
  sku_id: number | null;
  sku_code?: string | null;
  sku_specs?: Record<string, unknown> | null;
  sku_specs_en?: SpecsTranslation | null;
  quantity: number;
  created_at: Date;
  updated_at: Date;
  title?: string;
  title_en?: string | null;
  price?: number | string;
  main_image?: string;
  stock?: number;
  available?: boolean;
  unavailable_reason?: string | null;
}

export class CartModel {
  private static async transaction<T>(userId: number, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      // Match checkout's user -> product -> SKU order. This also serializes remove/clear
      // with writes, so a deleted item's old quantity cannot be restored by a late add.
      const [users] = await connection.execute<RowDataPacket[]>('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [userId]);
      if (!users.length) throw new PurchaseError('用户不存在', 404);
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  private static async mutate(connection: PoolConnection, userId: number, productId: number, quantity: number, skuId: number | undefined, add: boolean): Promise<boolean> {
    const [item] = normalizePurchaseItems([{ product_id: productId, sku_id: skuId, quantity }]);
    const { orderItems } = await pricePurchaseItems(connection, [item], true);
    // First consistent read after the user mutex; missing rows must not take gap locks.
    const [existing] = await connection.execute<RowDataPacket[]>(
      'SELECT quantity FROM cart WHERE user_id = ? AND product_id = ? AND sku_key = ?',
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
    return result.affectedRows > 0;
  }

  private static async write(userId: number, productId: number, quantity: number, skuId: number | undefined, add: boolean): Promise<boolean> {
    normalizePurchaseItems([{ product_id: productId, sku_id: skuId, quantity }]);
    return this.transaction(userId, connection => this.mutate(connection, userId, productId, quantity, skuId, add));
  }

  static async add(userId: number, productId: number, quantity: number, skuId?: number): Promise<boolean>;
  static async add(userId: number, productId: number, quantity: number, skuId: number | undefined, addKey: string): Promise<{ add_key: string; replayed: boolean }>;
  static async add(userId: number, productId: number, quantity: number, skuId?: number, addKey?: string): Promise<boolean | { add_key: string; replayed: boolean }> {
    if (addKey === undefined) return this.write(userId, productId, quantity, skuId, true);
    if (typeof addKey !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(addKey)) throw new PurchaseError('购物车添加请求号无效');
    const [item] = normalizePurchaseItems([{ product_id: productId, sku_id: skuId, quantity }]);
    const key = addKey.toLowerCase();
    const fingerprint = createHash('sha256').update(JSON.stringify([item.product_id, item.sku_id ?? null, item.quantity])).digest('hex');
    return this.transaction(userId, async connection => {
      // Read before catalog validation: a replay remains valid after checkout, remove, clear or a stock change.
      // The user mutex serializes receipts too; a missing receipt must not take a shared index gap lock.
      const [receipts] = await connection.execute<RowDataPacket[]>(
        'SELECT payload_fingerprint FROM cart_add_receipts WHERE user_id = ? AND add_key = ?', [userId, key]
      );
      if (receipts.length) {
        if (receipts[0].payload_fingerprint !== fingerprint) throw new PurchaseError('购物车添加请求号已用于其他内容，请先恢复原请求', 409);
        return { add_key: key, replayed: true };
      }
      if (!await this.mutate(connection, userId, item.product_id, item.quantity, item.sku_id, true)) throw new PurchaseError('添加失败');
      await connection.execute(
        'INSERT INTO cart_add_receipts (user_id, add_key, payload_fingerprint) VALUES (?, ?, ?)', [userId, key, fingerprint]
      );
      return { add_key: key, replayed: false };
    });
  }

  static async list(userId: number): Promise<CartItem[]> {
    const rows = await query<(CartItem & RowDataPacket)[]>(
      `SELECT c.*, p.title, p.title_en, p.status AS product_status,
              CASE WHEN c.sku_id IS NULL THEN p.price ELSE s.price END AS price,
              COALESCE(NULLIF(s.image, ''), p.main_image) AS main_image,
              CASE WHEN c.sku_id IS NULL THEN p.stock ELSE s.stock END AS stock,
              s.sku_code, s.specs AS sku_specs, s.specs_en AS sku_specs_en, s.status AS sku_status,
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
    return this.transaction(userId, async connection => {
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM cart WHERE user_id = ? AND product_id = ? AND sku_key = ?', [userId, productId, skuId ?? 0]
      );
      return result.affectedRows > 0;
    });
  }

  static async clear(userId: number): Promise<boolean> {
    return this.transaction(userId, async connection => {
      const [result] = await connection.execute<ResultSetHeader>('DELETE FROM cart WHERE user_id = ?', [userId]);
      return result.affectedRows > 0;
    });
  }
}
