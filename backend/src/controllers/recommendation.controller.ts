import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getRecommendationsByBrowseHistory,
  getRelatedProducts,
  getGuessYouLike
} from '../services/recommendation.service';
import logger from '../utils/logger';
import { RecommendationError, recommendationLimit, recommendationProductId } from '../utils/recommendation-validation';

export class RecommendationController {
  /**
   * 获取个性化推荐商品（基于浏览历史）
   */
  static async getPersonalized(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const limit = recommendationLimit(req.query);

      const recommendations = await getRecommendationsByBrowseHistory(userId, limit);

      res.json({
        recommendations,
        total: recommendations.length
      });
    } catch (error) {
      if (error instanceof RecommendationError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '获取个性化推荐失败');
      res.status(500).json({ error: '获取推荐失败' });
    }
  }

  /**
   * 获取相关商品推荐
   */
  static async getRelated(req: AuthRequest, res: Response) {
    try {
      const productId = recommendationProductId(req.params.productId);
      const limit = recommendationLimit(req.query);

      const relatedProducts = await getRelatedProducts(productId, limit);

      res.json({
        related_products: relatedProducts,
        total: relatedProducts.length
      });
    } catch (error) {
      if (error instanceof RecommendationError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '获取相关商品失败');
      res.status(500).json({ error: '获取相关商品失败' });
    }
  }

  /**
   * 猜你喜欢
   */
  static async getGuessYouLike(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId || null;
      const limit = recommendationLimit(req.query);

      const recommendations = await getGuessYouLike(userId, limit);

      res.json({
        recommendations,
        total: recommendations.length
      });
    } catch (error) {
      if (error instanceof RecommendationError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '获取猜你喜欢失败');
      res.status(500).json({ error: '获取推荐失败' });
    }
  }
}

