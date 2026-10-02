import { Request, Response } from 'express';
import { ProductModel } from '../models/product.model';
import { SKUModel } from '../models/sku.model';
import { getRedisClient } from '../database/redis';
import logger from '../utils/logger';
import { productCreateSchema, productQuerySchema, productUpdateSchema, positiveId } from '../utils/product-validation';

export class ProductController {
  // 获取商品列表
  static async list(req: Request, res: Response) {
    try {
      const { error, value: params } = productQuerySchema.validate(req.query);
      if (error) return res.status(400).json({ error: '商品查询参数无效' });

      const result = await ProductModel.list(params);
      
      res.json({
        products: result.products,
        total: result.total,
        page: params.page,
        limit: params.limit,
        totalPages: Math.ceil(result.total / params.limit!)
      });
    } catch (error) {
      logger.error({ err: error }, '获取商品列表失败');
      res.status(500).json({ error: '获取商品列表失败' });
    }
  }

  // 获取商品详情
  static async getDetail(req: Request, res: Response) {
    try {
      const productId = positiveId(req.params.id);
      if (!productId) return res.status(400).json({ error: '商品ID无效' });
      const redis = getRedisClient();

      // 尝试从缓存获取
      const cacheKey = `product:${productId}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        return res.json({ product: JSON.parse(cached), fromCache: true });
      }

      // 从数据库获取
      const product = await ProductModel.findById(productId);

      if (!product) {
        return res.status(404).json({ error: '商品不存在' });
      }

      // 获取SKU信息
      const skus = await SKUModel.findByProductId(productId);
      const productWithSKU = {
        ...product,
        skus: skus.length > 0 ? skus : undefined,
        has_sku: skus.length > 0
      };

      // 缓存5分钟
      await redis.setex(cacheKey, 300, JSON.stringify(productWithSKU));

      res.json({ product: productWithSKU });
    } catch (error) {
      logger.error({ err: error }, '获取商品详情失败');
      res.status(500).json({ error: '获取商品详情失败' });
    }
  }

  // 获取热门商品
  static async getHotProducts(req: Request, res: Response) {
    try {
      const { error, value } = productQuerySchema.validate({ limit: req.query.limit ?? 10 });
      if (error) return res.status(400).json({ error: '商品数量无效' });
      const limit = value.limit;
      const redis = getRedisClient();

      // 尝试从缓存获取
      const cacheKey = 'products:hot';
      const cached = await redis.get(cacheKey);

      if (cached) {
        return res.json({ products: JSON.parse(cached).slice(0, limit), fromCache: true });
      }

      // 从数据库获取
      const products = await ProductModel.getHotProducts(100);

      // 缓存10分钟
      await redis.setex(cacheKey, 600, JSON.stringify(products));

      res.json({ products: products.slice(0, limit) });
    } catch (error) {
      logger.error({ err: error }, '获取热门商品失败');
      res.status(500).json({ error: '获取热门商品失败' });
    }
  }

  // 创建商品（管理员）
  static async create(req: Request, res: Response) {
    try {
      const { error, value: product } = productCreateSchema.validate(req.body);
      if (error) return res.status(400).json({ error: '商品字段或值无效' });
      const productId = await ProductModel.create(product);
      
      res.status(201).json({
        message: '商品创建成功',
        product_id: productId
      });
    } catch (error) {
      logger.error({ err: error }, '创建商品失败');
      res.status(500).json({ error: '创建商品失败' });
    }
  }

  // 更新商品（管理员）
  static async update(req: Request, res: Response) {
    try {
      const productId = positiveId(req.params.id);
      const { error, value: updates } = productUpdateSchema.validate(req.body);
      if (!productId || error) return res.status(400).json({ error: '商品ID、字段或值无效' });
      
      const success = await ProductModel.update(productId, updates);
      
      if (success) {
        // 清除缓存
        try {
          await getRedisClient().del(`product:${productId}`, 'products:hot');
        } catch (cacheError) {
          logger.warn({ err: cacheError }, '商品已更新，缓存清理失败');
        }
        
        res.json({ message: '商品更新成功' });
      } else {
        res.status(400).json({ error: '商品更新失败' });
      }
    } catch (error) {
      logger.error({ err: error }, '更新商品失败');
      res.status(500).json({ error: '更新商品失败' });
    }
  }

  // 获取分类列表
  static async getCategories(req: Request, res: Response) {
    try {
      const { getPool } = require('../database/mysql');
      const pool = getPool();
      
      const [categories] = await pool.query(
        'SELECT category_id, name, parent_id, sort_order FROM categories ORDER BY sort_order ASC, category_id ASC'
      );
      
      res.json(categories);
    } catch (error) {
      logger.error({ err: error }, '获取分类列表失败');
      res.status(500).json({ error: '获取分类列表失败' });
    }
  }
}
