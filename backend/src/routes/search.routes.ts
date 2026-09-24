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

/**
 * @openapi
 * /api/search/es:
 *   get:
 *     tags: [搜索]
 *     summary: Elasticsearch 高级搜索
 *     description: 公开接口，支持关键词、分类、价格区间、品牌筛选与排序
 *     parameters:
 *       - name: keyword
 *         in: query
 *         required: true
 *         schema: { type: string }
 *       - name: category_id
 *         in: query
 *         schema: { type: integer }
 *       - name: min_price
 *         in: query
 *         schema: { type: number }
 *       - name: max_price
 *         in: query
 *         schema: { type: number }
 *       - name: brand
 *         in: query
 *         schema: { type: string }
 *       - name: sort_by
 *         in: query
 *         schema: { type: string, enum: [price, sales, created_at], default: sales }
 *       - name: sort_order
 *         in: query
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: page_size
 *         in: query
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: 搜索结果（分页）
 */
router.get('/es', elasticsearchSearch);

/**
 * @openapi
 * /api/search/hot:
 *   get:
 *     tags: [搜索]
 *     summary: 获取热搜关键词
 *     description: 公开接口
 *     parameters:
 *       - name: days
 *         in: query
 *         schema: { type: integer, default: 7 }
 *         description: 统计最近 N 天
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: 热搜关键词列表
 */
router.get('/hot', getHotKeywords);

/**
 * @openapi
 * /api/search/suggestions:
 *   get:
 *     tags: [搜索]
 *     summary: 获取搜索建议
 *     description: 公开接口，输入前缀返回补全建议
 *     parameters:
 *       - name: keyword
 *         in: query
 *         required: true
 *         schema: { type: string }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 5 }
 *     responses:
 *       200:
 *         description: 建议关键词列表
 */
router.get('/suggestions', getSearchSuggestions);

// 以下需要登录
router.use(authMiddleware);

/**
 * @openapi
 * /api/search/record:
 *   post:
 *     tags: [搜索]
 *     summary: 记录搜索
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [keyword]
 *             properties:
 *               keyword: { type: string }
 *               result_count: { type: integer, description: 搜索结果数 }
 *     responses:
 *       200:
 *         description: 记录成功
 */
router.post('/record', recordSearch);

/**
 * @openapi
 * /api/search/history:
 *   get:
 *     tags: [搜索]
 *     summary: 获取用户搜索历史
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: 搜索历史列表
 */
router.get('/history', getUserSearchHistory);

/**
 * @openapi
 * /api/search/history:
 *   delete:
 *     tags: [搜索]
 *     summary: 清除搜索历史
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 清除成功
 */
router.delete('/history', clearSearchHistory);

/**
 * @openapi
 * /api/search/history/{keyword}:
 *   delete:
 *     tags: [搜索]
 *     summary: 删除单条搜索记录
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: keyword
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/history/:keyword', deleteSearchKeyword);

export default router;
