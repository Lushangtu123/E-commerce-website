import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 所有订单接口都需要登录
router.use(authMiddleware);

// 创建订单
router.post('/', OrderController.create);

// 获取订单列表
router.get('/', OrderController.list);

// 获取订单详情
router.get('/:id', OrderController.getDetail);

// 取消订单
router.post('/:id/cancel', OrderController.cancel);

// 支付订单
router.post('/:id/pay', OrderController.pay);

// 确认收货
router.post('/:id/confirm', OrderController.confirm);

export default router;

