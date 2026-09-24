import express from 'express';
import {
  adminLogin,
  getAdminProfile,
  getDashboardStats,
  getRecentOrders,
  getTopProducts,
  getSalesTrend,
  getAdminLogs
} from '../controllers/admin.controller';
import { authenticateAdmin, requirePermission } from '../middleware/admin-auth';
import { authLimiter } from '../middleware/rate-limit';

const router = express.Router();

/**
 * @openapi
 * /api/admin/login:
 *   post:
 *     tags: [管理后台]
 *     summary: 管理员登录
 *     description: 登录接口带防暴力破解限流，返回管理员 Token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: 登录成功，返回管理员信息与 Token
 *       401:
 *         description: 用户名或密码错误 / 账号被禁用
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: 触发登录防爆破限流
 */
router.post('/login', authLimiter, adminLogin);

// 需要认证的路由
router.use(authenticateAdmin);

/**
 * @openapi
 * /api/admin/profile:
 *   get:
 *     tags: [管理后台]
 *     summary: 获取管理员信息
 *     security: [{ adminAuth: [] }]
 *     responses:
 *       200:
 *         description: 当前管理员信息（含角色权限）
 *       401:
 *         description: 未登录或 Token 无效
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/profile', getAdminProfile);

/**
 * @openapi
 * /api/admin/dashboard/stats:
 *   get:
 *     tags: [管理后台]
 *     summary: 仪表盘核心指标
 *     description: 今日销售额、订单数、用户数、商品数等
 *     security: [{ adminAuth: [] }]
 *     responses:
 *       200:
 *         description: 统计指标
 */
router.get('/dashboard/stats', getDashboardStats);

/**
 * @openapi
 * /api/admin/dashboard/recent-orders:
 *   get:
 *     tags: [管理后台]
 *     summary: 仪表盘最新订单
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: 最新订单列表
 */
router.get('/dashboard/recent-orders', getRecentOrders);

/**
 * @openapi
 * /api/admin/dashboard/top-products:
 *   get:
 *     tags: [管理后台]
 *     summary: 仪表盘热销商品 Top
 *     security: [{ adminAuth: [] }]
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
 *         description: 热销商品排行
 */
router.get('/dashboard/top-products', getTopProducts);

/**
 * @openapi
 * /api/admin/dashboard/sales-trend:
 *   get:
 *     tags: [管理后台]
 *     summary: 仪表盘销售趋势
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: days
 *         in: query
 *         schema: { type: integer, default: 7 }
 *         description: 最近 N 天
 *     responses:
 *       200:
 *         description: 每日销售额趋势
 */
router.get('/dashboard/sales-trend', getSalesTrend);

/**
 * @openapi
 * /api/admin/logs:
 *   get:
 *     tags: [管理后台]
 *     summary: 获取操作日志
 *     description: 需要 log:view 权限，支持按操作类型、管理员、时间范围筛选
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: action
 *         in: query
 *         schema: { type: string }
 *         description: 操作类型，如 CREATE_PRODUCT
 *       - name: adminId
 *         in: query
 *         schema: { type: integer }
 *         description: 按管理员筛选
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: 操作日志列表（分页）
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/AdminLog' }
 *       403:
 *         description: 无 log:view 权限
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/logs', requirePermission('log:view'), getAdminLogs);

export default router;
