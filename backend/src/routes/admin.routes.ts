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

// 公开路由（防暴力破解）
router.post('/login', authLimiter, adminLogin);

// 需要认证的路由
router.use(authenticateAdmin);

// 管理员信息
router.get('/profile', getAdminProfile);

// 仪表盘数据
router.get('/dashboard/stats', getDashboardStats);
router.get('/dashboard/recent-orders', getRecentOrders);
router.get('/dashboard/top-products', getTopProducts);
router.get('/dashboard/sales-trend', getSalesTrend);

// 操作日志
router.get('/logs', requirePermission('log:view'), getAdminLogs);

export default router;

