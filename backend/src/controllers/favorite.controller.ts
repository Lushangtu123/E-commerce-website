import { Response } from 'express';
import { FavoriteModel } from '../models/favorite.model';
import { AuthRequest } from '../middleware/auth';

// 添加收藏
export const addFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_id } = req.body;

    if (!product_id) {
      return res.status(400).json({ message: '商品ID不能为空' });
    }

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
    console.error('添加收藏失败:', error);
    res.status(500).json({ message: '添加收藏失败' });
  }
};

// 取消收藏
export const removeFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_id } = req.params;

    const success = await FavoriteModel.remove(userId, Number(product_id));

    if (!success) {
      return res.status(404).json({ message: '收藏记录不存在' });
    }

    res.json({ message: '取消收藏成功' });
  } catch (error) {
    console.error('取消收藏失败:', error);
    res.status(500).json({ message: '取消收藏失败' });
  }
};

// 切换收藏状态
export const toggleFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_id } = req.body;

    if (!product_id) {
      return res.status(400).json({ message: '商品ID不能为空' });
    }

    const isFavorited = await FavoriteModel.isFavorited(userId, product_id);

    if (isFavorited) {
      await FavoriteModel.remove(userId, product_id);
      return res.json({ 
        message: '取消收藏成功',
        is_favorited: false 
      });
    } else {
      const favoriteId = await FavoriteModel.add(userId, product_id);
      return res.json({ 
        message: '收藏成功',
        is_favorited: true,
        favorite_id: favoriteId 
      });
    }
  } catch (error) {
    console.error('切换收藏状态失败:', error);
    res.status(500).json({ message: '操作失败' });
  }
};

// 检查收藏状态
export const checkFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_id } = req.params;

    const isFavorited = await FavoriteModel.isFavorited(userId, Number(product_id));

    res.json({ is_favorited: isFavorited });
  } catch (error) {
    console.error('检查收藏状态失败:', error);
    res.status(500).json({ message: '检查收藏状态失败' });
  }
};

// 获取用户收藏列表
export const getUserFavorites = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

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
    console.error('获取收藏列表失败:', error);
    res.status(500).json({ message: '获取收藏列表失败' });
  }
};

// 批量检查收藏状态
export const checkMultipleFavorites = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_ids } = req.body;

    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ message: '商品ID列表不能为空' });
    }

    const favoriteMap = await FavoriteModel.checkMultipleFavorites(
      userId,
      product_ids.map(Number)
    );

    res.json({ favorites: favoriteMap });
  } catch (error) {
    console.error('批量检查收藏状态失败:', error);
    res.status(500).json({ message: '批量检查收藏状态失败' });
  }
};

// 获取收藏数量
export const getFavoriteCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const count = await FavoriteModel.getFavoriteCount(userId);

    res.json({ count });
  } catch (error) {
    console.error('获取收藏数量失败:', error);
    res.status(500).json({ message: '获取收藏数量失败' });
  }
};

