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
 *             properties:
 *               product_id: { type: integer }
 *     responses:
 *       200:
 *         description: 记录成功
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
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: 浏览历史列表（分页）
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
 *     summary: 删除单条浏览记录
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - name: product_id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/history/:product_id', deleteBrowseRecord);

export default router;
