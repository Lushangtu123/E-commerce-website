import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { OrderModel, OrderStatus } from '../models/order.model';
import { ProductModel } from '../models/product.model';
import { CartModel } from '../models/cart.model';
import { getRedisClient } from '../database/redis';
import { getOrderRemainingTime } from '../services/order-timeout.service';

export class OrderController {
  // 创建订单
  static async create(req: AuthRequest, res: Response) {
    try {
      const { items, shipping_address_id, remark } = req.body;

      if (!items || items.length === 0) {
        return res.status(400).json({ error: '订单商品不能为空' });
      }

      const redis = getRedisClient();
      let totalAmount = 0;
      const orderItems = [];

      // 验证商品库存和价格
      for (const item of items) {
        const product = await ProductModel.findById(item.product_id);
        
        if (!product) {
          return res.status(400).json({ error: `商品 ${item.product_id} 不存在` });
        }

        if (product.stock < item.quantity) {
          return res.status(400).json({ error: `商品 ${product.title} 库存不足` });
        }

        totalAmount += product.price * item.quantity;
        
        orderItems.push({
          product_id: product.product_id,
          product_name: product.title,
          product_image: product.main_image,
          quantity: item.quantity,
          price: product.price
        });
      }

      // 创建订单
      const orderId = await OrderModel.create(
        req.userId!,
        orderItems,
        totalAmount,
        shipping_address_id,
        remark
      );

      // 扣减库存
      for (const item of orderItems) {
        await ProductModel.decrStock(item.product_id, item.quantity);
        
        // 清除缓存
        await redis.del(`product:${item.product_id}`);
      }

      // 从购物车删除已下单商品
      const productIds = orderItems.map(item => item.product_id);
      await CartModel.removeMultiple(req.userId!, productIds);

      // TODO: 发送订单超时取消消息到MQ

      res.status(201).json({
        message: '订单创建成功',
        order_id: orderId
      });
    } catch (error) {
      console.error('创建订单失败:', error);
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
      console.error('获取订单详情失败:', error);
      res.status(500).json({ error: '获取订单详情失败' });
    }
  }

  // 获取订单列表
  static async list(req: AuthRequest, res: Response) {
    try {
      const status = req.query.status ? parseInt(req.query.status as string) : undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      const result = await OrderModel.listByUser(req.userId!, status, page, limit);

      res.json({
        orders: result.orders,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit)
      });
    } catch (error) {
      console.error('获取订单列表失败:', error);
      res.status(500).json({ error: '获取订单列表失败' });
    }
  }

  // 取消订单
  static async cancel(req: AuthRequest, res: Response) {
    try {
      const orderId = parseInt(req.params.id);
      
      const order = await OrderModel.findById(orderId);
      
      if (!order) {
        return res.status(404).json({ error: '订单不存在' });
      }

      if (order.user_id !== req.userId) {
        return res.status(403).json({ error: '无权操作该订单' });
      }

      if (order.status !== OrderStatus.PENDING) {
        return res.status(400).json({ error: '订单状态不允许取消' });
      }

      // 取消订单
      await OrderModel.cancel(orderId);

      // 恢复库存
      const items = await OrderModel.getOrderItems(orderId);
      for (const item of items) {
        await ProductModel.update(item.product_id, {
          stock: undefined // 需要增加库存，这里需要修改
        } as any);
      }

      res.json({ message: '订单已取消' });
    } catch (error) {
      console.error('取消订单失败:', error);
      res.status(500).json({ error: '取消订单失败' });
    }
  }

  // 支付订单（模拟）
  static async pay(req: AuthRequest, res: Response) {
    try {
      const orderId = parseInt(req.params.id);
      
      const order = await OrderModel.findById(orderId);
      
      if (!order) {
        return res.status(404).json({ error: '订单不存在' });
      }

      if (order.user_id !== req.userId) {
        return res.status(403).json({ error: '无权操作该订单' });
      }

      if (order.status !== OrderStatus.PENDING) {
        return res.status(400).json({ error: '订单状态不允许支付' });
      }

      // 更新订单状态为已支付
      await OrderModel.updateStatus(orderId, OrderStatus.PAID);

      // 增加销量
      const items = await OrderModel.getOrderItems(orderId);
      for (const item of items) {
        await ProductModel.incrSales(item.product_id, item.quantity);
      }

      res.json({ message: '支付成功' });
    } catch (error) {
      console.error('支付订单失败:', error);
      res.status(500).json({ error: '支付订单失败' });
    }
  }

  // 确认收货
  static async confirm(req: AuthRequest, res: Response) {
    try {
      const orderId = parseInt(req.params.id);
      
      const order = await OrderModel.findById(orderId);
      
      if (!order) {
        return res.status(404).json({ error: '订单不存在' });
      }

      if (order.user_id !== req.userId) {
        return res.status(403).json({ error: '无权操作该订单' });
      }

      if (order.status !== OrderStatus.SHIPPED) {
        return res.status(400).json({ error: '订单状态不允许确认收货' });
      }

      // 更新订单状态为已完成
      await OrderModel.updateStatus(orderId, OrderStatus.COMPLETED);

      res.json({ message: '确认收货成功' });
    } catch (error) {
      console.error('确认收货失败:', error);
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
      console.error('获取剩余时间失败:', error);
      res.status(500).json({ error: '获取剩余时间失败' });
    }
  }
}

