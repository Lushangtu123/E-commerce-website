import { getPool, query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { skuCreateSchema, skuUpdateSchema, validSKUId } from '../utils/sku-validation';
import { SpecsTranslation } from '../utils/product-i18n';
import { AdminAuditContext, writeAdminAudit } from '../utils/admin-write-audit';

export class SKUError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) { super(message); }
}

function checkId(id: unknown): asserts id is number {
  if (!validSKUId(id)) throw new SKUError('商品或SKU ID无效');
}

function validateCreate(data: any) {
  const { product_id, ...fields } = data || {};
  checkId(product_id);
  const { error, value } = skuCreateSchema.validate(fields);
  if (error) throw new SKUError('SKU字段或值无效');
  return { product_id, ...value };
}

async function lockProduct(connection: PoolConnection, productId: number): Promise<void> {
  const [products] = await connection.execute<RowDataPacket[]>(
    'SELECT product_id, status FROM products WHERE product_id = ? FOR UPDATE', [productId]
  );
  if (products.length === 0 || products[0].status === -1) throw new SKUError('商品不存在', 404);
}

async function lockProductSKUs(connection: PoolConnection, productId: number): Promise<ProductSKU[]> {
  await lockProduct(connection, productId);
  const [skus] = await connection.execute<(ProductSKU & RowDataPacket)[]>(
    'SELECT * FROM product_skus WHERE product_id = ? ORDER BY sku_id FOR UPDATE', [productId]
  );
  return skus;
}

async function skuTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error: any) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw new SKUError('SKU编码已存在', 409);
    throw error;
  } finally { connection.release(); }
}

async function resolveParentId(skuId: number, productId?: number): Promise<number | undefined> {
  checkId(skuId);
  if (productId !== undefined) { checkId(productId); return productId; }
  // A nonlocking lookup only locates the parent; membership is checked again after parent/SKU locks.
  const [skus] = await getPool().execute<RowDataPacket[]>(
    'SELECT product_id FROM product_skus WHERE sku_id = ?', [skuId]
  );
  return skus[0]?.product_id;
}

export interface ProductSKU {
  sku_id: number;
  product_id: number;
  sku_code: string;
  specs: any; // JSON格式：{"颜色":"红色","尺寸":"M"}
  specs_en?: SpecsTranslation | null;
  price: number;
  original_price?: number;
  stock: number;
  image?: string;
  status: number; // 1:启用 0:禁用
  created_at: Date;
  updated_at: Date;
}

function parseSKU(sku: ProductSKU): ProductSKU {
  return {
    ...sku,
    specs: typeof sku.specs === 'string' ? JSON.parse(sku.specs) : sku.specs,
    specs_en: typeof sku.specs_en === 'string' ? JSON.parse(sku.specs_en) : sku.specs_en,
  };
}

export class SKUModel {
  // 创建SKU
  static async create(data: {
    product_id: number;
    sku_code: string;
    specs: any;
    specs_en?: SpecsTranslation | null;
    price: number;
    original_price?: number;
    stock: number;
    image?: string;
    status?: number;
  }, audit?: AdminAuditContext): Promise<number> {
    const fields = validateCreate(data);
    return skuTransaction(async connection => {
      // The parent mutex serializes creation for this product. Locking an empty
      // SKU range would also block unrelated products' first inserts.
      await lockProduct(connection, fields.product_id);
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO product_skus (product_id, sku_code, specs, specs_en, price, original_price, stock, image, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fields.product_id, fields.sku_code, JSON.stringify(fields.specs), fields.specs_en == null ? null : JSON.stringify(fields.specs_en), fields.price,
          fields.original_price ?? null, fields.stock, fields.image ?? null, fields.status]
      );
      if (audit) await writeAdminAudit(connection, audit, 'CREATE_SKU', 'sku', String(result.insertId), `为商品${fields.product_id}创建SKU: ${fields.sku_code}`);
      return result.insertId;
    });
  }

  // 批量创建SKU
  static async createBatch(skus: any[], audit?: AdminAuditContext): Promise<void> {
    if (!Array.isArray(skus) || skus.length === 0 || skus.length > 100) throw new SKUError('SKU列表无效');
    const fields = skus.map(validateCreate);
    const codes = new Set(fields.map(sku => sku.sku_code));
    if (codes.size !== fields.length) throw new SKUError('SKU编码重复', 409);
    const productIds: number[] = [...new Set<number>(fields.map(sku => sku.product_id))].sort((left, right) => left - right);
    await skuTransaction(async connection => {
      for (const productId of productIds) await lockProduct(connection, productId);
      for (const sku of fields) {
        await connection.execute(
          `INSERT INTO product_skus (product_id, sku_code, specs, specs_en, price, original_price, stock, image, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [sku.product_id, sku.sku_code, JSON.stringify(sku.specs), sku.specs_en == null ? null : JSON.stringify(sku.specs_en), sku.price,
            sku.original_price ?? null, sku.stock, sku.image ?? null, sku.status]
        );
      }
      if (audit) await writeAdminAudit(connection, audit, 'BATCH_CREATE_SKU', 'sku', String(fields[0].product_id), `为商品${fields[0].product_id}批量创建${fields.length}个SKU`);
    });
  }

  // 根据ID获取SKU
  static async findById(skuId: number): Promise<ProductSKU | null> {
    const results = await query<(ProductSKU & RowDataPacket)[]>(
      'SELECT * FROM product_skus WHERE sku_id = ?',
      [skuId]
    );
    
    if (results.length === 0) return null;
    
    return parseSKU(results[0]);
  }

  // 根据SKU编码获取
  static async findBySKUCode(skuCode: string): Promise<ProductSKU | null> {
    const results = await query<(ProductSKU & RowDataPacket)[]>(
      'SELECT * FROM product_skus WHERE sku_code = ?',
      [skuCode]
    );
    
    if (results.length === 0) return null;
    
    return parseSKU(results[0]);
  }

  // 获取商品的所有SKU
  static async findByProductId(productId: number, includeDisabled: boolean = false): Promise<ProductSKU[]> {
    checkId(productId);
    const results = await query<(ProductSKU & RowDataPacket)[]>(
      `SELECT * FROM product_skus WHERE product_id = ?${includeDisabled ? '' : ' AND status = 1'} ORDER BY sku_id`,
      [productId]
    );
    
    return results.map(parseSKU);
  }

  // 更新SKU
  static async update(skuId: number, data: Partial<ProductSKU>, productId?: number, audit?: AdminAuditContext): Promise<boolean> {
    const { error, value } = skuUpdateSchema.validate(data);
    if (error) throw new SKUError('SKU字段或值无效');
    const parentId = await resolveParentId(skuId, productId);
    if (parentId === undefined) return false;
    return skuTransaction(async connection => {
      const skus = await lockProductSKUs(connection, parentId);
      if (!skus.some(sku => sku.sku_id === skuId)) {
        if (productId !== undefined) throw new SKUError('SKU不属于该商品', 404);
        return false;
      }
      const keys = Object.keys(value);
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE product_skus SET ${keys.map(key => `${key} = ?`).join(', ')} WHERE sku_id = ? AND product_id = ?`,
        [...keys.map(key => ['specs', 'specs_en'].includes(key) && value[key] != null ? JSON.stringify(value[key]) : value[key]), skuId, parentId]
      );
      if (result.affectedRows && audit) await writeAdminAudit(connection, audit, 'UPDATE_SKU', 'sku', String(skuId), '更新SKU');
      return result.affectedRows > 0;
    });
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
  static async delete(skuId: number, productId?: number, audit?: AdminAuditContext): Promise<boolean> {
    const parentId = await resolveParentId(skuId, productId);
    if (parentId === undefined) return false;
    return skuTransaction(async connection => {
      const skus = await lockProductSKUs(connection, parentId);
      if (!skus.some(sku => sku.sku_id === skuId)) {
        if (productId !== undefined) throw new SKUError('SKU不属于该商品', 404);
        return false;
      }
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE product_skus SET status = 0 WHERE sku_id = ? AND product_id = ?', [skuId, parentId]
      );
      if (result.affectedRows && audit) await writeAdminAudit(connection, audit, 'DELETE_SKU', 'sku', String(skuId), '删除SKU');
      return result.affectedRows > 0;
    });
  }

  // 删除商品的所有SKU
  static async deleteByProductId(productId: number): Promise<boolean> {
    checkId(productId);
    return skuTransaction(async connection => {
      await lockProductSKUs(connection, productId);
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE product_skus SET status = 0 WHERE product_id = ?', [productId]
      );
      return result.affectedRows > 0;
    });
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
    
    return parseSKU(results[0]);
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
