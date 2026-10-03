import express from 'express';
import {
  recordBrowse,
  getUserBrowseHistory,
  clearBrowseHistory,
  deleteBrowseRecord
} from '../controllers/browse-history.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// 所有浏览历史路由都需要认证
router.use(authMiddleware);

/**
 * @openapi
 * /api/browse/record:
 *   post:
 *     tags: [浏览历史]
 *     summary: 记录浏览
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [product_id]
 *             additionalProperties: false
 *             properties:
 *               product_id: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *     responses:
 *       200:
 *         description: 记录成功
 *       400:
 *         description: 商品 ID 或请求体无效
 *       404:
 *         description: 商品不存在或未上架
 */
router.post('/record', recordBrowse);

/**
 * @openapi
 * /api/browse/history:
 *   get:
 *     tags: [浏览历史]
 *     summary: 获取浏览历史
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 2147483647, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: history 及 pagination（page、limit、total、total_pages）；按商品选最新浏览时间的记录，同时间按记录 ID 倒序，缺失商品仍可删除
 *       400:
 *         description: 分页参数必须是范围内的规范正整数字符串，不接受重复或未知参数
 */
router.get('/history', getUserBrowseHistory);

/**
 * @openapi
 * /api/browse/history:
 *   delete:
 *     tags: [浏览历史]
 *     summary: 清除浏览历史
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 清除成功
 */
router.delete('/history', clearBrowseHistory);

/**
 * @openapi
 * /api/browse/history/{product_id}:
 *   delete:
 *     tags: [浏览历史]
 *     summary: 删除本人该商品的全部浏览记录
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: product_id
 *         in: path
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 9007199254740991 }
 *     responses:
 *       200:
 *         description: 删除成功
 *       400:
 *         description: 商品 ID 无效
 *       404:
 *         description: 本人浏览记录不存在
 */
router.delete('/history/:product_id', deleteBrowseRecord);

export default router;
