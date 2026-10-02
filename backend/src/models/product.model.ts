import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PRODUCT_SORTS, productCreateSchema, productQuerySchema, productUpdateSchema } from '../utils/product-validation';

export interface Product {
  product_id: number;
  title: string;
  description?: string;
  category_id?: number;
  brand?: string;
  price: number;
  original_price?: number;
  stock: number;
  has_sku?: boolean | number;
  sales_count: number;
  rating: number;
  main_image?: string;
  images?: string[];
  specs?: any;
  status: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProductQuery {
  category_id?: number;
  keyword?: string;
  min_price?: number;
  max_price?: number;
  sort?: string;
  page?: number;
  limit?: number;
}

// Customer prices and availability come from enabled variants; legacy parent stock remains independent.
export const customerProducts = `SELECT p.product_id, p.title, p.description, p.category_id, p.brand,
  CASE WHEN s.product_id IS NULL THEN p.price ELSE COALESCE(s.price, p.price) END AS price,
  p.original_price, CASE WHEN s.product_id IS NULL THEN p.stock ELSE COALESCE(s.stock, 0) END AS stock,
  p.sales_count, p.rating, p.main_image, p.images, p.specs, p.status, p.created_at, p.updated_at,
  (s.product_id IS NOT NULL) AS has_sku
  FROM products p LEFT JOIN (
    SELECT product_id, MIN(CASE WHEN status = 1 THEN price END) AS price,
      SUM(CASE WHEN status = 1 THEN stock ELSE 0 END) AS stock
    FROM product_skus GROUP BY product_id
  ) s ON p.product_id = s.product_id`;

export class ProductModel {
  // 创建商品
  static async create(product: Partial<Product>): Promise<number> {
    const { error, value } = productCreateSchema.validate(product);
    if (error) throw error;
    const { title, description, category_id, brand, price, original_price, stock, main_image, images, specs, status } = value;
    
    const result = await query<ResultSetHeader>(
      `INSERT INTO products (title, description, category_id, brand, price, original_price, stock, main_image, images, specs, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description ?? null, category_id ?? null, brand ?? null, price, original_price ?? null, stock, main_image ?? null,
        images == null ? null : JSON.stringify(images), specs == null ? null : JSON.stringify(specs), status]
    );
    return result.insertId;
  }

  // 获取商品列表
  static async list(params: ProductQuery): Promise<{ products: Product[], total: number }> {
    const { error, value } = productQuerySchema.validate(params);
    if (error) throw error;
    const { category_id, keyword, min_price, max_price, page, limit } = value;
    const sort = PRODUCT_SORTS[value.sort];
    
    let whereClauses: string[] = ['status = 1'];
    let queryParams: any[] = [];

    if (category_id) {
      whereClauses.push('category_id = ?');
      queryParams.push(category_id);
    }

    if (keyword) {
      whereClauses.push('(title LIKE ? OR description LIKE ?)');
      queryParams.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (min_price !== undefined) {
      whereClauses.push('price >= ?');
      queryParams.push(min_price);
    }

    if (max_price !== undefined) {
      whereClauses.push('price <= ?');
      queryParams.push(max_price);
    }

    const whereClause = whereClauses.join(' AND ');
    const offset = (page - 1) * limit;

    // 获取总数
    const countResult = await query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM (${customerProducts}) AS products WHERE ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // 获取商品列表
    const products = await query<(Product & RowDataPacket)[]>(
      `SELECT * FROM (${customerProducts}) AS products WHERE ${whereClause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return { products, total };
  }

  // 根据ID获取商品
  static async findById(productId: number): Promise<Product | null> {
    const products = await query<(Product & RowDataPacket)[]>(
      'SELECT * FROM products WHERE product_id = ?',
      [productId]
    );
    return products.length > 0 ? products[0] : null;
  }

  // 更新商品
  static async update(productId: number, updates: Partial<Product>): Promise<boolean> {
    const { error, value } = productUpdateSchema.validate(updates);
    if (error) throw error;
    const keys = Object.keys(value);
    const fields = keys.map(key => `${key} = ?`).join(', ');
    const values = [...keys.map(key => ['images', 'specs'].includes(key) && value[key] != null ? JSON.stringify(value[key]) : value[key]), productId];
    
    const result = await query<ResultSetHeader>(
      `UPDATE products SET ${fields} WHERE product_id = ?`,
      values
    );
    return result.affectedRows > 0;
  }

  // 扣减库存
  static async decrStock(productId: number, quantity: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'UPDATE products SET stock = stock - ? WHERE product_id = ? AND stock >= ?',
      [quantity, productId, quantity]
    );
    return result.affectedRows > 0;
  }

  // 增加销量
  static async incrSales(productId: number, quantity: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'UPDATE products SET sales_count = sales_count + ? WHERE product_id = ?',
      [quantity, productId]
    );
    return result.affectedRows > 0;
  }

  // 获取热门商品
  static async getHotProducts(limit: number = 10): Promise<Product[]> {
    return await query<(Product & RowDataPacket)[]>(
      `SELECT * FROM (${customerProducts}) AS products WHERE status = 1 ORDER BY sales_count DESC LIMIT ?`,
      [limit]
    );
  }
}
