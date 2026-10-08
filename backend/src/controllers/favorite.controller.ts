import { Response } from 'express';
import { FavoriteModel } from '../models/favorite.model';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { CustomerActivityError, activityListSchema, activityProductSchema, activityBatchSchema, activityPathId } from '../utils/customer-activity-validation';

function productInput(body: unknown): number {
  const { error, value } = activityProductSchema.validate(body);
  if (error) throw new CustomerActivityError('商品ID或字段无效');
  return value.product_id;
}

// 添加收藏
export const addFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const product_id = productInput(req.body);

    const favoriteId = await FavoriteModel.add(userId, product_id);

    if (favoriteId === 0) {
      return res.status(200).json({ 
        message: '该商品已在收藏夹中',
        already_favorited: true 
      });
    }

    res.json({
      message: '收藏成功',
      favorite_id: favoriteId
    });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '添加收藏失败');
    res.status(500).json({ message: '添加收藏失败' });
  }
};

// 取消收藏
export const removeFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = activityPathId(req.params.product_id);
    const success = await FavoriteModel.remove(userId, productId);

    if (!success) {
      return res.status(404).json({ message: '收藏记录不存在' });
    }

    res.json({ message: '取消收藏成功' });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '取消收藏失败');
    res.status(500).json({ message: '取消收藏失败' });
  }
};

// 切换收藏状态
export const toggleFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const product_id = productInput(req.body);

    const result = await FavoriteModel.toggle(userId, product_id);
    return res.json({ message: result.is_favorited ? '收藏成功' : '取消收藏成功', ...result });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '切换收藏状态失败');
    res.status(500).json({ message: '操作失败' });
  }
};

// 检查收藏状态
export const checkFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = activityPathId(req.params.product_id);
    const isFavorited = await FavoriteModel.isFavorited(userId, productId);

    res.json({ is_favorited: isFavorited });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '检查收藏状态失败');
    res.status(500).json({ message: '检查收藏状态失败' });
  }
};

// 获取用户收藏列表
export const getUserFavorites = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { error, value } = activityListSchema.validate(req.query);
    if (error) return res.status(400).json({ message: '分页参数无效' });
    const { page, limit } = value;

    const { favorites, total } = await FavoriteModel.getUserFavorites(userId, page, limit);

    res.json({
      favorites,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '获取收藏列表失败');
    res.status(500).json({ message: '获取收藏列表失败' });
  }
};

// 批量检查收藏状态
export const checkMultipleFavorites = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { error, value } = activityBatchSchema.validate(req.body);
    if (error) return res.status(400).json({ message: '商品ID列表或字段无效' });
    const favoriteMap = await FavoriteModel.checkMultipleFavorites(userId, value.product_ids);

    res.json({ favorites: favoriteMap });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '批量检查收藏状态失败');
    res.status(500).json({ message: '批量检查收藏状态失败' });
  }
};

// 获取收藏数量
export const getFavoriteCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const count = await FavoriteModel.getFavoriteCount(userId);

    res.json({ count });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '获取收藏数量失败');
    res.status(500).json({ message: '获取收藏数量失败' });
  }
};
