import express from 'express';
import {
  recordSearch,
  getUserSearchHistory,
  getHotKeywords,
  clearSearchHistory,
  deleteSearchKeyword,
  getSearchSuggestions,
  elasticsearchSearch
} from '../controllers/search.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Elasticsearch 高级搜索（公开）
router.get('/es', elasticsearchSearch);

// 获取热搜关键词（公开）
router.get('/hot', getHotKeywords);

// 获取搜索建议（公开）
router.get('/suggestions', getSearchSuggestions);

// 以下需要登录
router.use(authMiddleware);

// 记录搜索
router.post('/record', recordSearch);

// 获取用户搜索历史
router.get('/history', getUserSearchHistory);

// 清除搜索历史
router.delete('/history', clearSearchHistory);

// 删除单条搜索记录
router.delete('/history/:keyword', deleteSearchKeyword);

export default router;

