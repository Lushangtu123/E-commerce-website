import express from 'express';
import {
  getAdminUsers,
  getAdminUserDetail,
  updateUserStatus,
  getUserStatistics,
  getUserOrders
} from '../controllers/admin-user.controller';
import { authenticateAdmin, requirePermission } from '../middleware/admin-auth';

const router = express.Router();

// 所有路由都需要管理员认证
router.use(authenticateAdmin);

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [管理后台-用户]
 *     summary: 获取用户列表
 *     description: 需要 user:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: 用户列表（分页）
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/User' }
 */
router.get('/', requirePermission('user:view'), getAdminUsers);

/**
 * @openapi
 * /api/admin/users/stats/overview:
 *   get:
 *     tags: [管理后台-用户]
 *     summary: 获取用户统计
 *     description: 需要 user:view 权限
 *     security: [{ adminAuth: [] }]
 *     responses:
 *       200:
 *         description: 用户统计数据
 */
router.get('/stats/overview', requirePermission('user:view'), getUserStatistics);

/**
 * @openapi
 * /api/admin/users/{userId}:
 *   get:
 *     tags: [管理后台-用户]
 *     summary: 获取用户详情
 *     description: 需要 user:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 用户详情
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       404:
 *         description: 用户不存在
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:userId', requirePermission('user:view'), getAdminUserDetail);

/**
 * @openapi
 * /api/admin/users/{userId}/orders:
 *   get:
 *     tags: [管理后台-用户]
 *     summary: 获取用户订单
 *     description: 需要 user:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: 用户订单列表（分页）
 */
router.get('/:userId/orders', requirePermission('user:view'), getUserOrders);

/**
 * @openapi
 * /api/admin/users/{userId}/status:
 *   put:
 *     tags: [管理后台-用户]
 *     summary: 更新用户状态
 *     description: 需要 user:edit 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: userId
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
 *               status: { type: integer, description: '1 正常，0 禁用' }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:userId/status', requirePermission('user:edit'), updateUserStatus);

export default router;
