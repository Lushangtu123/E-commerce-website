import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { ReviewModel } from '../models/review.model';
import logger from '../utils/logger';
import { ReviewError, parseReviewInput, parseReviewPage, reviewProductPathId } from '../utils/review-validation';

export class ReviewController {
  // 创建评论
  static async create(req: AuthRequest, res: Response) {
    try {
      const { product_id, order_id, rating, content, images } = parseReviewInput(req.body);

      // 创建评论
      const reviewId = await ReviewModel.create(
        product_id,
        req.userId!,
        order_id,
        rating,
        content ?? undefined,
        images
      );

      res.status(201).json({
        message: '评论成功',
        review_id: reviewId
      });
    } catch (error) {
      if (error instanceof ReviewError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '创建评论失败');
      res.status(500).json({ error: '创建评论失败' });
    }
  }

  // 获取商品评论列表
  static async listByProduct(req: Request, res: Response) {
    try {
      const productId = reviewProductPathId(req.params.id);
      const { page, limit } = parseReviewPage(req.query);

      const result = await ReviewModel.listByProduct(productId, page, limit);

      res.json({
        reviews: result.reviews,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      });
    } catch (error) {
      if (error instanceof ReviewError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '获取评论列表失败');
      res.status(500).json({ error: '获取评论列表失败' });
    }
  }

  // 获取我的评论列表
  static async listByUser(req: AuthRequest, res: Response) {
    try {
      const { page, limit } = parseReviewPage(req.query);

      const result = await ReviewModel.listByUser(req.userId!, page, limit);

      res.json({
        reviews: result.reviews,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      });
    } catch (error) {
      if (error instanceof ReviewError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '获取评论列表失败');
      res.status(500).json({ error: '获取评论列表失败' });
    }
  }
}
