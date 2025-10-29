import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface ProductSKU {
  sku_id: number;
  product_id: number;
  sku_code: string;
  specs: any; // JSON格式：{"颜色":"红色","尺寸":"M"}
  price: number;
  original_price?: number;
  stock: number;
  image?: string;
  status: number; // 1:启用 0:禁用
  created_at: Date;
  updated_at: Date;
}

export class SKUModel {
  // 创建SKU
  static async create(data: {
    product_id: number;
    sku_code: string;
    specs: any;
    price: number;
    original_price?: number;
    stock: number;
    image?: string;
  }): Promise<number> {
    const result = await query<ResultSetHeader>(
      `INSERT INTO product_skus (product_id, sku_code, specs, price, original_price, stock, image)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.product_id,
        data.sku_code,
        JSON.stringify(data.specs),
        data.price,
        data.original_price || null,
        data.stock,
        data.image || null
      ]
    );
    return result.insertId;
  }

  // 批量创建SKU
  static async createBatch(skus: any[]): Promise<void> {
    if (skus.length === 0) return;

    const values = skus.map(sku => [
      sku.product_id,
      sku.sku_code,
      JSON.stringify(sku.specs),
      sku.price,
      sku.original_price || null,
      sku.stock,
      sku.image || null
    ]);

    const placeholders = skus.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flatValues = values.flat();

    await query(
      `INSERT INTO product_skus (product_id, sku_code, specs, price, original_price, stock, image)
       VALUES ${placeholders}`,
      flatValues
    );
  }

  // 根据ID获取SKU
  static async findById(skuId: number): Promise<ProductSKU | null> {
    const results = await query<(ProductSKU & RowDataPacket)[]>(
      'SELECT * FROM product_skus WHERE sku_id = ?',
      [skuId]
    );
    
    if (results.length === 0) return null;
    
    const sku = results[0];
    sku.specs = typeof sku.specs === 'string' ? JSON.parse(sku.specs) : sku.specs;
    return sku;
  }

  // 根据SKU编码获取
  static async findBySKUCode(skuCode: string): Promise<ProductSKU | null> {
    const results = await query<(ProductSKU & RowDataPacket)[]>(
      'SELECT * FROM product_skus WHERE sku_code = ?',
      [skuCode]
    );
    
    if (results.length === 0) return null;
    
    const sku = results[0];
    sku.specs = typeof sku.specs === 'string' ? JSON.parse(sku.specs) : sku.specs;
    return sku;
  }

  // 获取商品的所有SKU
  static async findByProductId(productId: number): Promise<ProductSKU[]> {
    const results = await query<(ProductSKU & RowDataPacket)[]>(
      'SELECT * FROM product_skus WHERE product_id = ? AND status = 1 ORDER BY sku_id',
      [productId]
    );
    
    return results.map(sku => ({
      ...sku,
      specs: typeof sku.specs === 'string' ? JSON.parse(sku.specs) : sku.specs
    }));
  }

  // 更新SKU
  static async update(skuId: number, data: Partial<ProductSKU>): Promise<boolean> {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.specs !== undefined) {
      updates.push('specs = ?');
      values.push(JSON.stringify(data.specs));
    }
    if (data.price !== undefined) {
      updates.push('price = ?');
      values.push(data.price);
    }
    if (data.original_price !== undefined) {
      updates.push('original_price = ?');
      values.push(data.original_price);
    }
    if (data.stock !== undefined) {
      updates.push('stock = ?');
      values.push(data.stock);
    }
    if (data.image !== undefined) {
      updates.push('image = ?');
      values.push(data.image);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) return false;

    values.push(skuId);

    const result = await query<ResultSetHeader>(
      `UPDATE product_skus SET ${updates.join(', ')} WHERE sku_id = ?`,
      values
    );

    return result.affectedRows > 0;
  }

  // 更新库存
  static async updateStock(skuId: number, quantity: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'UPDATE product_skus SET stock = stock + ? WHERE sku_id = ?',
      [quantity, skuId]
    );
    return result.affectedRows > 0;
  }

  // 减少库存（用于下单）
  static async decreaseStock(skuId: number, quantity: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'UPDATE product_skus SET stock = stock - ? WHERE sku_id = ? AND stock >= ?',
      [quantity, skuId, quantity]
    );
    return result.affectedRows > 0;
  }

  // 删除SKU
  static async delete(skuId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM product_skus WHERE sku_id = ?',
      [skuId]
    );
    return result.affectedRows > 0;
  }

  // 删除商品的所有SKU
  static async deleteByProductId(productId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM product_skus WHERE product_id = ?',
      [productId]
    );
    return result.affectedRows > 0;
  }

  // 获取最低价格的SKU
  static async getLowestPriceSKU(productId: number): Promise<ProductSKU | null> {
    const results = await query<(ProductSKU & RowDataPacket)[]>(
      `SELECT * FROM product_skus 
       WHERE product_id = ? AND status = 1 
       ORDER BY price ASC 
       LIMIT 1`,
      [productId]
    );
    
    if (results.length === 0) return null;
    
    const sku = results[0];
    sku.specs = typeof sku.specs === 'string' ? JSON.parse(sku.specs) : sku.specs;
    return sku;
  }

  // 获取总库存
  static async getTotalStock(productId: number): Promise<number> {
    const [result] = await query<RowDataPacket[]>(
      'SELECT SUM(stock) as total FROM product_skus WHERE product_id = ? AND status = 1',
      [productId]
    );
    return result.total || 0;
  }
}

