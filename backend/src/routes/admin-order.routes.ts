import express from 'express';
import {
  getAdminOrders,
  getAdminOrderDetail,
  updateOrderStatus,
  getOrderStatistics
} from '../controllers/admin-order.controller';
import { authenticateAdmin, requirePermission } from '../middleware/admin-auth';

const router = express.Router();

// 所有路由都需要管理员认证
router.use(authenticateAdmin);

/**
 * @openapi
 * /api/admin/orders:
 *   get:
 *     tags: [管理后台-订单]
 *     summary: 获取订单列表
 *     description: 需要 order:view 权限，支持多条件筛选
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: orderNo
 *         in: query
 *         schema: { type: string }
 *         description: 按订单号模糊搜索
 *       - name: userId
 *         in: query
 *         schema: { type: integer }
 *       - name: status
 *         in: query
 *         schema: { type: integer }
 *         description: 按订单状态筛选
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: 订单列表（分页）
 */
router.get('/', requirePermission('order:view'), getAdminOrders);

/**
 * @openapi
 * /api/admin/orders/stats/overview:
 *   get:
 *     tags: [管理后台-订单]
 *     summary: 获取订单统计
 *     description: 需要 statistics:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: 订单统计数据
 */
router.get('/stats/overview', requirePermission('statistics:view'), getOrderStatistics);

/**
 * @openapi
 * /api/admin/orders/{orderId}:
 *   get:
 *     tags: [管理后台-订单]
 *     summary: 获取订单详情
 *     description: 需要 order:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: orderId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 订单详情（含订单项）
 *       404:
 *         description: 订单不存在
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:orderId', requirePermission('order:view'), getAdminOrderDetail);

/**
 * @openapi
 * /api/admin/orders/{orderId}/status:
 *   put:
 *     tags: [管理后台-订单]
 *     summary: 更新订单状态
 *     description: 需要 order:edit 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: orderId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: integer, description: 目标订单状态 }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:orderId/status', requirePermission('order:edit'), updateOrderStatus);

export default router;
