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

// 获取订单列表
router.get('/', requirePermission('order:view'), getAdminOrders);

// 获取订单详情
router.get('/:orderId', requirePermission('order:view'), getAdminOrderDetail);

// 更新订单状态
router.put('/:orderId/status', requirePermission('order:edit'), updateOrderStatus);

// 获取订单统计
router.get('/stats/overview', requirePermission('statistics:view'), getOrderStatistics);

export default router;

