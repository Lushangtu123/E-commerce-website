import { Request, Response } from 'express';
import { getPool } from '../database/mysql';
import logger from '../utils/logger';
import { ProductModel } from '../models/product.model';
import { productCreateSchema, productUpdateSchema, positiveId } from '../utils/product-validation';
import { afterProductWrite } from './admin-product-write';
import { AdminQueryError, adminProductsQuerySchema, parseAdminQuery } from '../utils/admin-query-validation';

function normalizedProductBody(body: any) {
  const { image_url, ...fields } = body;
  return image_url === undefined ? fields : { ...fields, main_image: image_url };
}

// 获取商品列表（管理员）
export const getAdminProducts = async (req: Request, res: Response) => {
  try {
    const {page, limit, keyword, categoryId, status} = parseAdminQuery(req.query, adminProductsQuerySchema);
    const pool = getPool();
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params: any[] = [];

    if (keyword) {
      whereClause += ' AND (p.title LIKE ? OR p.description LIKE ? OR p.title_en LIKE ? OR p.description_en LIKE ?)';
      params.push(...Array(4).fill(`%${keyword}%`));
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
        c.name as category_name,
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
    if (error instanceof AdminQueryError) return res.status(400).json({error: error.message});
    logger.error({ err: error }, '获取商品列表失败');
    res.status(500).json({ error: '获取商品列表失败' });
  }
};

// 更新商品状态（上下架）
export const updateProductStatus = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const productId = positiveId(req.params.productId);
    if (!productId) return res.status(400).json({ error: '商品ID无效' });
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
    await afterProductWrite(req, [Number(productId)], 'UPDATE_PRODUCT_STATUS', 'product', String(productId), `${status === 1 ? '上架' : '下架'}商品: ${product.title}`);

    res.json({ message: '更新成功', status });
  } catch (error) {
    logger.error({ err: error }, '更新商品状态失败');
    res.status(500).json({ error: '更新失败' });
  }
};

// 批量更新商品状态
export const batchUpdateProductStatus = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { productIds, status } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0 || productIds.length > 100 || !productIds.every(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id <= 2147483647)) {
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
    await afterProductWrite(req, productIds, 'BATCH_UPDATE_PRODUCT_STATUS', 'product', productIds.join(','), `批量${status === 1 ? '上架' : '下架'}商品: ${productIds.length}个`);

    res.json({ message: '批量更新成功', count: productIds.length });
  } catch (error) {
    logger.error({ err: error }, '批量更新商品状态失败');
    res.status(500).json({ error: '批量更新失败' });
  }
};

// 创建商品
export const createProduct = async (req: Request, res: Response) => {
  try {
    const { error, value: product } = productCreateSchema.validate(normalizedProductBody(req.body));
    if (error || !product.category_id) return res.status(400).json({ error: '商品字段或值无效，标题、价格和分类必填' });
    const { title } = product;
    const productId = await ProductModel.create(product);

    // 记录操作日志
    await afterProductWrite(req, [productId], 'CREATE_PRODUCT', 'product', String(productId), `创建商品: ${title}`);

    res.status(201).json({
      message: '创建成功',
      product_id: productId
    });
  } catch (error) {
    logger.error({ err: error }, '创建商品失败');
    res.status(500).json({ error: '创建失败' });
  }
};

// 更新商品信息
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const productId = positiveId(req.params.productId);
    const { error, value: fields } = productUpdateSchema.validate(normalizedProductBody(req.body));
    if (!productId || error) return res.status(400).json({ error: '商品ID、字段或值无效' });
    const pool = getPool();

    // 检查商品是否存在
    const [products] = await pool.query(
      'SELECT product_id FROM products WHERE product_id = ?',
      [productId]
    );

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }

    await ProductModel.update(productId, fields);

    // 记录操作日志
    await afterProductWrite(req, [productId], 'UPDATE_PRODUCT', 'product', String(productId), `更新商品: ${fields.title || ''}`);

    res.json({ message: '更新成功' });
  } catch (error) {
    logger.error({ err: error }, '更新商品失败');
    res.status(500).json({ error: '更新失败' });
  }
};

// 删除商品（软删除）
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const productId = positiveId(req.params.productId);
    if (!productId) return res.status(400).json({ error: '商品ID无效' });

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
    await afterProductWrite(req, [Number(productId)], 'DELETE_PRODUCT', 'product', String(productId), `删除商品: ${product.title}`);

    res.json({ message: '删除成功' });
  } catch (error) {
    logger.error({ err: error }, '删除商品失败');
    res.status(500).json({ error: '删除失败' });
  }
};
