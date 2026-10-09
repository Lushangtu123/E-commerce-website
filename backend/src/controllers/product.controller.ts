import { Request, Response } from 'express';
import { ProductModel, type Product } from '../models/product.model';
import { SKUModel } from '../models/sku.model';
import { getRedisClient } from '../database/redis';
import logger from '../utils/logger';
import { PRODUCT_HOT_CACHE_KEY } from '../utils/product-cache-keys';
import { afterProductWrite } from './admin-product-write';
import { productCreateSchema, productQuerySchema, productUpdateSchema, positiveId } from '../utils/product-validation';
import { specsTranslationSchema } from '../utils/product-i18n';
import { adminAuditContext } from '../utils/admin-write-audit';

const optionalText = (value: unknown) => value == null || typeof value === 'string';
const optionalRecord = (value: unknown) => value == null || typeof value === 'object' && !Array.isArray(value);

function isCachedProduct(value: unknown): value is Product & { review_count: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const product = value as Record<string, unknown>;
  return Number.isSafeInteger(product.product_id) && Number(product.product_id) > 0 && typeof product.title === 'string' &&
    [product.title_en, product.description, product.description_en, product.main_image].every(optionalText) &&
    optionalRecord(product.specs) && !specsTranslationSchema.validate(product.specs_en, { convert: false }).error &&
    (typeof product.price === 'number' || typeof product.price === 'string') && Number.isFinite(Number(product.price)) && Number(product.price) >= 0 &&
    (typeof product.stock === 'number' || (typeof product.stock === 'string' && /^(0|[1-9]\d*)$/.test(product.stock))) &&
    Number.isSafeInteger(Number(product.stock)) && Number(product.stock) >= 0 &&
    (typeof product.rating === 'number' || typeof product.rating === 'string') && Number.isFinite(Number(product.rating)) && Number(product.rating) >= 0 && Number(product.rating) <= 5 &&
    Number.isSafeInteger(product.review_count) && Number(product.review_count) >= 0;
}

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
      // Details are read from MySQL on every request so a disabled product cannot remain purchasable.
      const product = await ProductModel.findById(productId);
      if (!product || product.status !== 1) return res.status(404).json({ error: '商品不存在' });
      const allSKUs = await SKUModel.findByProductId(productId, true);
      const skus = allSKUs.filter(sku => sku.status === 1);
      const hasSKU = allSKUs.length > 0;
      const productWithSKU = {
        // Public details must not inherit internal columns added to the products table.
        product_id: product.product_id,
        title: product.title,
        title_en: product.title_en,
        description: product.description,
        description_en: product.description_en,
        category_id: product.category_id,
        brand: product.brand,
        original_price: product.original_price,
        sales_count: product.sales_count,
        rating: product.rating,
        review_count: product.review_count,
        main_image: product.main_image,
        images: product.images,
        specs: product.specs,
        specs_en: product.specs_en,
        status: product.status,
        created_at: product.created_at,
        updated_at: product.updated_at,
        skus: hasSKU ? skus : undefined,
        has_sku: hasSKU,
        stock: hasSKU ? skus.reduce((stock, sku) => stock + Number(sku.stock), 0) : product.stock,
        price: skus.length > 0 ? Math.min(...skus.map(sku => Number(sku.price))) : product.price,
      };
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
      const cacheKey = PRODUCT_HOT_CACHE_KEY;
      try {
        const cached = await getRedisClient().get(cacheKey);
        if (cached) {
          const products = JSON.parse(cached);
          if (!Array.isArray(products) || products.length > 100 || !products.every(isCachedProduct)) {
            throw new Error('Invalid hot product cache');
          }
          // The cached list supplies ranking only. Every displayed field comes from current enabled rows.
          const ids = [...new Set(products.map(product => product.product_id))] as number[];
          const current = await ProductModel.findEnabledByIds(ids);
          const byId = new Map(current.map(product => [product.product_id, product]));
          const ranked = ids.flatMap(id => { const product = byId.get(id); return product ? [product] : []; });
          return res.json({ products: ranked.slice(0, limit), fromCache: true });
        }
      } catch (cacheError) {
        logger.warn({ err: cacheError }, '热门商品缓存读取失败，改用数据库');
      }

      // 从数据库获取
      const products = await ProductModel.getHotProducts(100);

      // 缓存10分钟
      try {
        await getRedisClient().setex(cacheKey, 600, JSON.stringify(products));
      } catch (cacheError) {
        logger.warn({ err: cacheError }, '热门商品缓存写入失败');
      }

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
      const productId = await ProductModel.create(product, adminAuditContext(req));
      await afterProductWrite([productId]);
      
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
      
      const success = await ProductModel.update(productId, updates, adminAuditContext(req));
      
      if (success) {
        await afterProductWrite([productId]);
        
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
