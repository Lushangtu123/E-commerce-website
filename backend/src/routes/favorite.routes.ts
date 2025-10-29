import express from 'express';
import {
  addFavorite,
  removeFavorite,
  toggleFavorite,
  checkFavorite,
  getUserFavorites,
  checkMultipleFavorites,
  getFavoriteCount
} from '../controllers/favorite.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// 所有收藏路由都需要认证
router.use(authMiddleware);

// 添加收藏
router.post('/', addFavorite);

// 切换收藏状态
router.post('/toggle', toggleFavorite);

// 取消收藏
router.delete('/:product_id', removeFavorite);

// 检查单个商品收藏状态
router.get('/check/:product_id', checkFavorite);

// 批量检查收藏状态
router.post('/check-multiple', checkMultipleFavorites);

// 获取用户收藏列表
router.get('/my', getUserFavorites);

// 获取收藏数量
router.get('/count', getFavoriteCount);

export default router;

