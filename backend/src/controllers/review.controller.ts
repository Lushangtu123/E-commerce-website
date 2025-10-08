import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { ReviewModel } from '../models/review.model';
import { OrderModel, OrderStatus } from '../models/order.model';

export class ReviewController {
  // 创建评论
  static async create(req: AuthRequest, res: Response) {
    try {
      const { product_id, order_id, rating, content, images } = req.body;

      if (!product_id || !order_id || !rating) {
        return res.status(400).json({ error: '参数错误' });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: '评分必须在1-5之间' });
      }

      // 验证订单
      const order = await OrderModel.findById(order_id);
      if (!order) {
        return res.status(404).json({ error: '订单不存在' });
      }

      if (order.user_id !== req.userId) {
        return res.status(403).json({ error: '无权评论该订单' });
      }

      if (order.status !== OrderStatus.COMPLETED) {
        return res.status(400).json({ error: '订单未完成，不能评论' });
      }

      // 检查是否已评论
      const hasReviewed = await ReviewModel.hasReviewed(req.userId!, order_id, product_id);
      if (hasReviewed) {
        return res.status(400).json({ error: '已评论过该商品' });
      }

      // 创建评论
      const reviewId = await ReviewModel.create(
        product_id,
        req.userId!,
        order_id,
        rating,
        content,
        images
      );

      res.status(201).json({
        message: '评论成功',
        review_id: reviewId
      });
    } catch (error) {
      console.error('创建评论失败:', error);
      res.status(500).json({ error: '创建评论失败' });
    }
  }

  // 获取商品评论列表
  static async listByProduct(req: Request, res: Response) {
    try {
      const productId = parseInt(req.params.id);
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      const result = await ReviewModel.listByProduct(productId, page, limit);

      res.json({
        reviews: result.reviews,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      });
    } catch (error) {
      console.error('获取评论列表失败:', error);
      res.status(500).json({ error: '获取评论列表失败' });
    }
  }

  // 获取我的评论列表
  static async listByUser(req: AuthRequest, res: Response) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      const result = await ReviewModel.listByUser(req.userId!, page, limit);

      res.json({
        reviews: result.reviews,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      });
    } catch (error) {
      console.error('获取评论列表失败:', error);
      res.status(500).json({ error: '获取评论列表失败' });
    }
  }
}

