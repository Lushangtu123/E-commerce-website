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
import { authMiddleware, optionalAuth } from '../middleware/auth';

const router = express.Router();

/**
 * @openapi
 * /api/search/es:
 *   get:
 *     tags: [搜索]
 *     summary: 商品搜索（Elasticsearch，可回退 MySQL）
 *     description: 公开接口，支持关键词、分类、价格区间、品牌筛选与排序。已配置 ELASTICSEARCH_URL 时用 Elasticsearch 匹配和排序，未配置或不可用时回退到 MySQL，响应的 engine 字段标明实际使用的引擎。价格、库存和上架状态始终取自 MySQL。登录用户的搜索计入本人搜索历史。page × page_size 不能超过 10000。
 *     parameters:
 *       - name: keyword
 *         in: query
 *         schema: { type: string, maxLength: 100 }
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
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: 搜索结果（分页）
 *       400:
 *         description: 搜索参数无效
 */
router.get('/es', optionalAuth, elasticsearchSearch);

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
 *         schema: { type: integer, minimum: 1, maximum: 365, default: 7 }
 *         description: 统计最近 N 天
 *       - name: limit
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *     responses:
 *       200:
 *         description: 热搜关键词列表
 *       400:
 *         description: 搜索参数无效
 */
router.get('/hot', getHotKeywords);

/**
 * @openapi
 * /api/search/suggestions:
 *   get:
 *     tags: [搜索]
 *     summary: 获取搜索建议
 *     description: 公开接口，输入前缀返回补全建议；空前缀返回空列表
 *     parameters:
 *       - name: keyword
 *         in: query
 *         schema: { type: string, maxLength: 100 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 5 }
 *     responses:
 *       200:
 *         description: 建议关键词列表
 *       400:
 *         description: 搜索参数无效
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
 *               keyword: { type: string, minLength: 1, maxLength: 100 }
 *               result_count: { type: integer, minimum: 0, maximum: 2147483647, default: 0, description: 搜索结果数 }
 *     responses:
 *       200:
 *         description: 记录成功
 *       400:
 *         description: 搜索参数无效
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
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *     responses:
 *       200:
 *         description: 搜索历史列表
 *       400:
 *         description: 搜索参数无效
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
 *         schema: { type: string, minLength: 1, maxLength: 100 }
 *     responses:
 *       200:
 *         description: 删除成功
 *       400:
 *         description: 搜索参数无效
 */
router.delete('/history/:keyword', deleteSearchKeyword);

export default router;
