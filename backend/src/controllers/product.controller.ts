import { Request, Response } from 'express';
import { ProductModel, ProductQuery } from '../models/product.model';
import { getRedisClient } from '../database/redis';

export class ProductController {
  // 获取商品列表
  static async list(req: Request, res: Response) {
    try {
      const params: ProductQuery = {
        category_id: req.query.category_id ? parseInt(req.query.category_id as string) : undefined,
        keyword: req.query.keyword as string,
        min_price: req.query.min_price ? parseFloat(req.query.min_price as string) : undefined,
        max_price: req.query.max_price ? parseFloat(req.query.max_price as string) : undefined,
        sort: req.query.sort as string || 'created_at DESC',
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 20
      };

      const result = await ProductModel.list(params);
      
      res.json({
        products: result.products,
        total: result.total,
        page: params.page,
        limit: params.limit,
        totalPages: Math.ceil(result.total / params.limit!)
      });
    } catch (error) {
      console.error('获取商品列表失败:', error);
      res.status(500).json({ error: '获取商品列表失败' });
    }
  }

  // 获取商品详情
  static async getDetail(req: Request, res: Response) {
    try {
      const productId = parseInt(req.params.id);
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

      // 缓存5分钟
      await redis.setex(cacheKey, 300, JSON.stringify(product));

      res.json({ product });
    } catch (error) {
      console.error('获取商品详情失败:', error);
      res.status(500).json({ error: '获取商品详情失败' });
    }
  }

  // 获取热门商品
  static async getHotProducts(req: Request, res: Response) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const redis = getRedisClient();

      // 尝试从缓存获取
      const cacheKey = 'products:hot';
      const cached = await redis.get(cacheKey);

      if (cached) {
        return res.json({ products: JSON.parse(cached), fromCache: true });
      }

      // 从数据库获取
      const products = await ProductModel.getHotProducts(limit);

      // 缓存10分钟
      await redis.setex(cacheKey, 600, JSON.stringify(products));

      res.json({ products });
    } catch (error) {
      console.error('获取热门商品失败:', error);
      res.status(500).json({ error: '获取热门商品失败' });
    }
  }

  // 创建商品（管理员）
  static async create(req: Request, res: Response) {
    try {
      const product = req.body;
      const productId = await ProductModel.create(product);
      
      res.status(201).json({
        message: '商品创建成功',
        product_id: productId
      });
    } catch (error) {
      console.error('创建商品失败:', error);
      res.status(500).json({ error: '创建商品失败' });
    }
  }

  // 更新商品（管理员）
  static async update(req: Request, res: Response) {
    try {
      const productId = parseInt(req.params.id);
      const updates = req.body;
      
      const success = await ProductModel.update(productId, updates);
      
      if (success) {
        // 清除缓存
        const redis = getRedisClient();
        await redis.del(`product:${productId}`);
        await redis.del('products:hot');
        
        res.json({ message: '商品更新成功' });
      } else {
        res.status(400).json({ error: '商品更新失败' });
      }
    } catch (error) {
      console.error('更新商品失败:', error);
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
      console.error('获取分类列表失败:', error);
      res.status(500).json({ error: '获取分类列表失败' });
    }
  }
}

