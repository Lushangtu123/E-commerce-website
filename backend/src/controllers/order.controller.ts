import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { OrderModel, OrderStatus, OrderListError, orderListQuerySchema } from '../models/order.model';
import { createOrder, previewOrder, transitionOrder, invalidateOrderProductCache, OrderError } from '../services/order.service';
import { getOrderRemainingTime } from '../services/order-timeout.service';
import { sendOrderTimeoutCheckMessage } from '../services/message-queue.service';
import logger from '../utils/logger';

export class OrderController {
  static async preview(req: AuthRequest, res: Response) {
    try {
      const { items, user_coupon_id } = req.body || {};
      res.json(await previewOrder(req.userId!, items, user_coupon_id));
    } catch (error) {
      if (error instanceof OrderError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '预览订单失败');
      res.status(500).json({ error: '预览订单失败' });
    }
  }

  // 创建订单
  static async create(req: AuthRequest, res: Response) {
    try {
      const { items, shipping_address_id, remark, user_coupon_id } = req.body || {};
      const { orderId, productIds, ...amounts } = await createOrder(req.userId!, items, shipping_address_id, remark, user_coupon_id);
      await invalidateOrderProductCache(productIds);

      // 发送订单超时检查消息到MQ（30分钟后若仍未支付，消费者将自动取消订单）
      // MQ 不可用不影响订单创建，订单超时检查定时任务会兜底处理
      try {
        const timeoutMsgSent = await sendOrderTimeoutCheckMessage(orderId, req.userId!);
        if (!timeoutMsgSent) {
          logger.warn('订单超时检查消息发送失败，将由定时任务兜底取消超时订单');
        }
      } catch (error) {
        logger.warn({ err: error }, '订单已创建，超时消息发送失败，将由定时任务兜底');
      }

      res.status(201).json({
        message: '订单创建成功',
        order_id: orderId,
        ...amounts,
      });
    } catch (error) {
      if (error instanceof OrderError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '创建订单失败');
      res.status(500).json({ error: '创建订单失败' });
    }
  }

  // 获取订单详情
  static async getDetail(req: AuthRequest, res: Response) {
    try {
      const orderId = parseInt(req.params.id);
      
      const order = await OrderModel.findById(orderId);
      
      if (!order) {
        return res.status(404).json({ error: '订单不存在' });
      }

      // 验证订单归属
      if (order.user_id !== req.userId) {
        return res.status(403).json({ error: '无权访问该订单' });
      }

      // 获取订单商品
      const items = await OrderModel.getOrderItems(orderId);

      res.json({
        order,
        items
      });
    } catch (error) {
      logger.error({ err: error }, '获取订单详情失败');
      res.status(500).json({ error: '获取订单详情失败' });
    }
  }

  // 获取订单列表
  static async list(req: AuthRequest, res: Response) {
    try {
      const { error, value } = orderListQuerySchema.validate(req.query);
      if (error) return res.status(400).json({ error: '订单查询参数无效' });
      const { status, page, limit } = value;

      const result = await OrderModel.listByUser(req.userId!, status, page, limit);

      res.json({
        orders: result.orders,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      });
    } catch (error) {
      if (error instanceof OrderListError) return res.status(400).json({ error: error.message });
      logger.error({ err: error }, '获取订单列表失败');
      res.status(500).json({ error: '获取订单列表失败' });
    }
  }

  // 取消订单
  static async cancel(req: AuthRequest, res: Response) {
    try {
      const result = await transitionOrder(Number(req.params.id), OrderStatus.CANCELLED, { userId: req.userId! });
      await invalidateOrderProductCache(result.productIds);

      res.json({ message: '订单已取消' });
    } catch (error) {
      if (error instanceof OrderError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '取消订单失败');
      res.status(500).json({ error: '取消订单失败' });
    }
  }

  // 支付订单（模拟）
  static async pay(req: AuthRequest, res: Response) {
    try {
      const result = await transitionOrder(Number(req.params.id), OrderStatus.PAID, { userId: req.userId! });
      await invalidateOrderProductCache(result.productIds);

      res.json({ message: '支付成功' });
    } catch (error) {
      if (error instanceof OrderError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '支付订单失败');
      res.status(500).json({ error: '支付订单失败' });
    }
  }

  // 确认收货
  static async confirm(req: AuthRequest, res: Response) {
    try {
      await transitionOrder(Number(req.params.id), OrderStatus.COMPLETED, { userId: req.userId! });

      res.json({ message: '确认收货成功' });
    } catch (error) {
      if (error instanceof OrderError) return res.status(error.statusCode).json({ error: error.message });
      logger.error({ err: error }, '确认收货失败');
      res.status(500).json({ error: '确认收货失败' });
    }
  }

  // 获取订单剩余支付时间
  static async getRemainingTime(req: AuthRequest, res: Response) {
    try {
      const orderId = parseInt(req.params.id);
      
      const order = await OrderModel.findById(orderId);
      
      if (!order) {
        return res.status(404).json({ error: '订单不存在' });
      }

      if (order.user_id !== req.userId) {
        return res.status(403).json({ error: '无权访问该订单' });
      }

      if (order.status !== OrderStatus.PENDING) {
        return res.json({ 
          remaining_minutes: 0,
          message: '订单不是待支付状态'
        });
      }

      const remainingMinutes = await getOrderRemainingTime(orderId);

      res.json({ 
        remaining_minutes: remainingMinutes,
        timeout_at: new Date(new Date(order.created_at).getTime() + 30 * 60 * 1000).toISOString()
      });
    } catch (error) {
      logger.error({ err: error }, '获取剩余时间失败');
      res.status(500).json({ error: '获取剩余时间失败' });
    }
  }
}
