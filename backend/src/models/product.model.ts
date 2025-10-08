import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Product {
  product_id: number;
  title: string;
  description?: string;
  category_id?: number;
  brand?: string;
  price: number;
  original_price?: number;
  stock: number;
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

export class ProductModel {
  // 创建商品
  static async create(product: Partial<Product>): Promise<number> {
    const { title, description, category_id, brand, price, original_price, stock, main_image, images, specs } = product;
    
    const result = await query<ResultSetHeader>(
      `INSERT INTO products (title, description, category_id, brand, price, original_price, stock, main_image, images, specs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, category_id, brand, price, original_price, stock, main_image, JSON.stringify(images), JSON.stringify(specs)]
    );
    return result.insertId;
  }

  // 获取商品列表
  static async list(params: ProductQuery): Promise<{ products: Product[], total: number }> {
    const { category_id, keyword, min_price, max_price, sort = 'created_at DESC', page = 1, limit = 20 } = params;
    
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
      `SELECT COUNT(*) as total FROM products WHERE ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // 获取商品列表
    const products = await query<(Product & RowDataPacket)[]>(
      `SELECT * FROM products WHERE ${whereClause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
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
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), productId];
    
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
      'SELECT * FROM products WHERE status = 1 ORDER BY sales_count DESC LIMIT ?',
      [limit]
    );
  }
}

