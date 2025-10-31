/**
 * 商品推荐服务
 * 基于用户浏览历史和商品相似度进行推荐
 */

import { getPool } from '../database/mysql';
import { RowDataPacket } from 'mysql2';
import mongoose from '../database/mongodb';

interface Product extends RowDataPacket {
  id: number;
  name: string;
  price: number;
  category_id: number;
  sales: number;
  main_image: string;
}

interface BrowseHistory {
  product_id: number;
  browsed_at: Date;
}

/**
 * 基于用户浏览历史推荐商品
 * 推荐逻辑：
 * 1. 获取用户最近浏览的商品
 * 2. 找到这些商品的分类
 * 3. 推荐同分类下的热门商品
 * 4. 排除用户已浏览的商品
 */
export async function getRecommendationsByBrowseHistory(
  userId: number,
  limit: number = 10
): Promise<Product[]> {
  try {
    const pool = getPool();

    // 1. 从 MongoDB 获取用户最近浏览的商品（最近20个）
    const BrowseHistory = mongoose.model('BrowseHistory');
    const browseHistory = await BrowseHistory
      .find({ user_id: userId })
      .sort({ browsed_at: -1 })
      .limit(20)
      .lean();

    if (browseHistory.length === 0) {
      // 如果没有浏览历史，返回热门商品
      return await getHotProducts(limit);
    }

    const browsedProductIds = browseHistory.map((h: any) => h.product_id);

    // 2. 获取浏览过的商品的分类
    const [browsedProducts] = await pool.execute<Product[]>(
      `SELECT DISTINCT category_id 
       FROM products 
       WHERE id IN (${browsedProductIds.join(',')})
       AND status = 'active'`
    );

    if (browsedProducts.length === 0) {
      return await getHotProducts(limit);
    }

    const categoryIds = browsedProducts.map(p => p.category_id);

    // 3. 推荐同分类下的热门商品（排除已浏览的）
    const [recommendations] = await pool.execute<Product[]>(
      `SELECT 
        id,
        name,
        price,
        category_id,
        sales,
        main_image,
        stock
       FROM products
       WHERE category_id IN (${categoryIds.join(',')})
       AND id NOT IN (${browsedProductIds.join(',')})
       AND status = 'active'
       AND stock > 0
       ORDER BY sales DESC, created_at DESC
       LIMIT ?`,
      [limit]
    );

    // 如果推荐商品不足，补充热门商品
    if (recommendations.length < limit) {
      const hotProducts = await getHotProducts(limit - recommendations.length);
      const existingIds = new Set(recommendations.map(p => p.id));
      const additionalProducts = hotProducts.filter(p => !existingIds.has(p.id));
      recommendations.push(...additionalProducts);
    }

    return recommendations;
  } catch (error) {
    console.error('[推荐服务] 获取推荐商品失败:', error);
    // 出错时返回热门商品
    return await getHotProducts(limit);
  }
}

/**
 * 基于商品相似度推荐
 * 推荐同分类的相关商品
 */
export async function getRelatedProducts(
  productId: number,
  limit: number = 10
): Promise<Product[]> {
  try {
    const pool = getPool();

    // 1. 获取当前商品信息
    const [currentProducts] = await pool.execute<Product[]>(
      'SELECT category_id, price FROM products WHERE id = ? AND status = "active"',
      [productId]
    );

    if (currentProducts.length === 0) {
      return [];
    }

    const currentProduct = currentProducts[0];

    // 2. 推荐同分类、价格相近的商品
    const priceMin = currentProduct.price * 0.7;
    const priceMax = currentProduct.price * 1.3;

    const [relatedProducts] = await pool.execute<Product[]>(
      `SELECT 
        id,
        name,
        price,
        category_id,
        sales,
        main_image,
        stock
       FROM products
       WHERE category_id = ?
       AND id != ?
       AND price BETWEEN ? AND ?
       AND status = 'active'
       AND stock > 0
       ORDER BY sales DESC
       LIMIT ?`,
      [currentProduct.category_id, productId, priceMin, priceMax, limit]
    );

    // 如果相关商品不足，补充同分类的其他商品
    if (relatedProducts.length < limit) {
      const [additionalProducts] = await pool.execute<Product[]>(
        `SELECT 
          id,
          name,
          price,
          category_id,
          sales,
          main_image,
          stock
         FROM products
         WHERE category_id = ?
         AND id != ?
         AND id NOT IN (${relatedProducts.map(p => p.id).join(',') || '0'})
         AND status = 'active'
         AND stock > 0
         ORDER BY sales DESC
         LIMIT ?`,
        [currentProduct.category_id, productId, limit - relatedProducts.length]
      );

      relatedProducts.push(...additionalProducts);
    }

    return relatedProducts;
  } catch (error) {
    console.error('[推荐服务] 获取相关商品失败:', error);
    return [];
  }
}

/**
 * 获取热门商品（兜底推荐）
 */
async function getHotProducts(limit: number): Promise<Product[]> {
  try {
    const pool = getPool();

    const [hotProducts] = await pool.execute<Product[]>(
      `SELECT 
        id,
        name,
        price,
        category_id,
        sales,
        main_image,
        stock
       FROM products
       WHERE status = 'active'
       AND stock > 0
       ORDER BY sales DESC, created_at DESC
       LIMIT ?`,
      [limit]
    );

    return hotProducts;
  } catch (error) {
    console.error('[推荐服务] 获取热门商品失败:', error);
    return [];
  }
}

/**
 * 为新用户推荐商品
 * 推荐各分类的热门商品
 */
export async function getNewUserRecommendations(limit: number = 10): Promise<Product[]> {
  try {
    const pool = getPool();

    // 获取每个分类的热门商品
    const [recommendations] = await pool.execute<Product[]>(
      `SELECT 
        p.id,
        p.name,
        p.price,
        p.category_id,
        p.sales,
        p.main_image,
        p.stock
       FROM (
         SELECT 
           id,
           name,
           price,
           category_id,
           sales,
           main_image,
           stock,
           ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY sales DESC) as rn
         FROM products
         WHERE status = 'active'
         AND stock > 0
       ) p
       WHERE p.rn <= 2
       ORDER BY p.sales DESC
       LIMIT ?`,
      [limit]
    );

    return recommendations;
  } catch (error) {
    console.error('[推荐服务] 获取新用户推荐失败:', error);
    return await getHotProducts(limit);
  }
}

/**
 * 猜你喜欢（综合推荐）
 * 结合浏览历史、热门商品、新品等多个维度
 */
export async function getGuessYouLike(
  userId: number | null,
  limit: number = 10
): Promise<Product[]> {
  try {
    if (!userId) {
      // 未登录用户，返回热门商品
      return await getHotProducts(limit);
    }

    // 登录用户，基于浏览历史推荐
    const recommendations = await getRecommendationsByBrowseHistory(userId, limit);
    
    return recommendations;
  } catch (error) {
    console.error('[推荐服务] 猜你喜欢失败:', error);
    return await getHotProducts(limit);
  }
}

