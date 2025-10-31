import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getRecommendationsByBrowseHistory,
  getRelatedProducts,
  getGuessYouLike
} from '../services/recommendation.service';

export class RecommendationController {
  /**
   * 获取个性化推荐商品（基于浏览历史）
   */
  static async getPersonalized(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const limit = parseInt(req.query.limit as string) || 10;

      const recommendations = await getRecommendationsByBrowseHistory(userId, limit);

      res.json({
        recommendations,
        total: recommendations.length
      });
    } catch (error) {
      console.error('获取个性化推荐失败:', error);
      res.status(500).json({ error: '获取推荐失败' });
    }
  }

  /**
   * 获取相关商品推荐
   */
  static async getRelated(req: AuthRequest, res: Response) {
    try {
      const productId = parseInt(req.params.productId);
      const limit = parseInt(req.query.limit as string) || 10;

      if (!productId) {
        return res.status(400).json({ error: '商品ID不能为空' });
      }

      const relatedProducts = await getRelatedProducts(productId, limit);

      res.json({
        related_products: relatedProducts,
        total: relatedProducts.length
      });
    } catch (error) {
      console.error('获取相关商品失败:', error);
      res.status(500).json({ error: '获取相关商品失败' });
    }
  }

  /**
   * 猜你喜欢
   */
  static async getGuessYouLike(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId || null;
      const limit = parseInt(req.query.limit as string) || 10;

      const recommendations = await getGuessYouLike(userId, limit);

      res.json({
        recommendations,
        total: recommendations.length
      });
    } catch (error) {
      console.error('获取猜你喜欢失败:', error);
      res.status(500).json({ error: '获取推荐失败' });
    }
  }
}


