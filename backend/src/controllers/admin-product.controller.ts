import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import { logAdminAction } from './admin.controller';

// 获取商品列表（管理员）
export const getAdminProducts = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    
    const { keyword, categoryId, status } = req.query;

    let whereClause = '1=1';
    const params: any[] = [];

    if (keyword) {
      whereClause += ' AND (p.title LIKE ? OR p.description LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (categoryId) {
      whereClause += ' AND p.category_id = ?';
      params.push(categoryId);
    }
    if (status !== undefined) {
      whereClause += ' AND p.status = ?';
      params.push(status);
    }

    const [products] = await pool.query(
      `SELECT 
        p.*,
        c.category_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = p.product_id) as total_sales
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.category_id
       WHERE ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM products p WHERE ${whereClause}`,
      params
    );

    const total = (countResult as any[])[0].total;

    res.json({
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取商品列表失败:', error);
    res.status(500).json({ error: '获取商品列表失败' });
  }
};

// 更新商品状态（上下架）
export const updateProductStatus = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { productId } = req.params;
    const { status } = req.body; // 1: 上架, 0: 下架

    if (status === undefined || (status !== 0 && status !== 1)) {
      return res.status(400).json({ error: '无效的状态值' });
    }

    // 获取商品信息
    const [products] = await pool.query(
      'SELECT product_id, title FROM products WHERE product_id = ?',
      [productId]
    );

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }

    const product = products[0] as any;

    // 更新状态
    await pool.query(
      'UPDATE products SET status = ?, updated_at = NOW() WHERE product_id = ?',
      [status, productId]
    );

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'UPDATE_PRODUCT_STATUS',
      'product',
      productId,
      `${status === 1 ? '上架' : '下架'}商品: ${product.title}`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: '更新成功', status });
  } catch (error) {
    console.error('更新商品状态失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
};

// 批量更新商品状态
export const batchUpdateProductStatus = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { productIds, status } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: '商品ID列表不能为空' });
    }

    if (status === undefined || (status !== 0 && status !== 1)) {
      return res.status(400).json({ error: '无效的状态值' });
    }

    const placeholders = productIds.map(() => '?').join(',');
    
    await pool.query(
      `UPDATE products SET status = ?, updated_at = NOW() WHERE product_id IN (${placeholders})`,
      [status, ...productIds]
    );

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'BATCH_UPDATE_PRODUCT_STATUS',
      'product',
      productIds.join(','),
      `批量${status === 1 ? '上架' : '下架'}商品: ${productIds.length}个`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: '批量更新成功', count: productIds.length });
  } catch (error) {
    console.error('批量更新商品状态失败:', error);
    res.status(500).json({ error: '批量更新失败' });
  }
};

// 创建商品
export const createProduct = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const {
      title,
      description,
      price,
      stock,
      category_id,
      image_url,
      status = 1
    } = req.body;

    if (!title || !price || !category_id) {
      return res.status(400).json({ error: '标题、价格和分类不能为空' });
    }

    const [result] = await pool.query(
      `INSERT INTO products 
       (title, description, price, stock, category_id, image_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [title, description, price, stock || 0, category_id, image_url, status]
    );

    const productId = (result as any).insertId;

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'CREATE_PRODUCT',
      'product',
      productId.toString(),
      `创建商品: ${title}`,
      req.ip,
      req.get('user-agent')
    );

    res.status(201).json({
      message: '创建成功',
      product_id: productId
    });
  } catch (error) {
    console.error('创建商品失败:', error);
    res.status(500).json({ error: '创建失败' });
  }
};

// 更新商品信息
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { productId } = req.params;
    const {
      title,
      description,
      price,
      stock,
      category_id,
      image_url
    } = req.body;

    // 检查商品是否存在
    const [products] = await pool.query(
      'SELECT product_id FROM products WHERE product_id = ?',
      [productId]
    );

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }

    // 构建更新字段
    const updates: string[] = [];
    const values: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (price !== undefined) {
      updates.push('price = ?');
      values.push(price);
    }
    if (stock !== undefined) {
      updates.push('stock = ?');
      values.push(stock);
    }
    if (category_id !== undefined) {
      updates.push('category_id = ?');
      values.push(category_id);
    }
    if (image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(image_url);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    updates.push('updated_at = NOW()');
    values.push(productId);

    await pool.query(
      `UPDATE products SET ${updates.join(', ')} WHERE product_id = ?`,
      values
    );

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'UPDATE_PRODUCT',
      'product',
      productId,
      `更新商品: ${title || ''}`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: '更新成功' });
  } catch (error) {
    console.error('更新商品失败:', error);
    res.status(500).json({ error: '更新失败' });
  }
};

// 删除商品（软删除）
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { productId } = req.params;

    // 获取商品信息
    const [products] = await pool.query(
      'SELECT product_id, title FROM products WHERE product_id = ?',
      [productId]
    );

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }

    const product = products[0] as any;

    // 软删除：将状态设为-1
    await pool.query(
      'UPDATE products SET status = -1, updated_at = NOW() WHERE product_id = ?',
      [productId]
    );

    // 记录操作日志
    await logAdminAction(
      (req as any).admin.adminId,
      'DELETE_PRODUCT',
      'product',
      productId,
      `删除商品: ${product.title}`,
      req.ip,
      req.get('user-agent')
    );

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除商品失败:', error);
    res.status(500).json({ error: '删除失败' });
  }
};

