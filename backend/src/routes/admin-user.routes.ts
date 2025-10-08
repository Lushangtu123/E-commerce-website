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

// 获取用户列表
router.get('/', requirePermission('user:view'), getAdminUsers);

// 获取用户统计
router.get('/stats/overview', requirePermission('user:view'), getUserStatistics);

// 获取用户详情
router.get('/:userId', requirePermission('user:view'), getAdminUserDetail);

// 获取用户订单
router.get('/:userId/orders', requirePermission('user:view'), getUserOrders);

// 更新用户状态
router.put('/:userId/status', requirePermission('user:edit'), updateUserStatus);

export default router;

