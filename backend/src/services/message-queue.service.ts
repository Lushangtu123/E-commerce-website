/**
 * 消息队列服务
 * 处理订单、库存等异步任务
 */
import { publishMessage, publishOrderTimeoutCheck, consumeQueue, QUEUES } from '../database/rabbitmq';
import { pool } from '../database/mysql';
import { RowDataPacket } from 'mysql2';
import { cancelTimeoutOrder } from './order-timeout.service';

/**
 * 订单创建消息处理器
 */
export async function handleOrderCreated(message: any) {
  const { order_id, user_id, items } = message;
  
  console.log(`📦 处理订单创建消息: order_id=${order_id}`);

  try {
    // 发送库存扣减消息
    for (const item of items) {
      await publishMessage(QUEUES.STOCK_DEDUCTION, {
        order_id,
        sku_id: item.sku_id,
        quantity: item.quantity,
      });
    }

    // 发送邮件通知消息（模拟）
    await publishMessage(QUEUES.EMAIL_NOTIFICATION, {
      type: 'order_created',
      user_id,
      order_id,
      subject: '订单创建成功',
      content: `您的订单 ${order_id} 已创建成功，请尽快完成支付。`,
    });

    console.log(`✅ 订单创建消息处理完成: order_id=${order_id}`);
  } catch (error) {
    console.error('❌ 处理订单创建消息失败:', error);
    throw error;
  }
}

/**
 * 订单支付消息处理器
 */
export async function handleOrderPaid(message: any) {
  const { order_id, user_id } = message;
  
  console.log(`💰 处理订单支付消息: order_id=${order_id}`);

  try {
    // 更新商品销量
    const [orderItems] = await pool.execute<RowDataPacket[]>(
      `SELECT sku_id, quantity 
       FROM order_items 
       WHERE order_id = ?`,
      [order_id]
    );

    for (const item of orderItems) {
      await pool.execute(
        `UPDATE products p
         INNER JOIN product_skus s ON p.product_id = s.product_id
         SET p.sales_count = p.sales_count + ?
         WHERE s.sku_id = ?`,
        [item.quantity, item.sku_id]
      );
    }

    // 发送邮件通知
    await publishMessage(QUEUES.EMAIL_NOTIFICATION, {
      type: 'order_paid',
      user_id,
      order_id,
      subject: '支付成功通知',
      content: `您的订单 ${order_id} 已支付成功，我们会尽快为您发货。`,
    });

    console.log(`✅ 订单支付消息处理完成: order_id=${order_id}`);
  } catch (error) {
    console.error('❌ 处理订单支付消息失败:', error);
    throw error;
  }
}

/**
 * 订单取消消息处理器
 */
export async function handleOrderCancelled(message: any) {
  const { order_id, user_id, items } = message;
  
  console.log(`❌ 处理订单取消消息: order_id=${order_id}`);

  try {
    // 发送库存恢复消息
    for (const item of items) {
      await publishMessage(QUEUES.STOCK_RECOVERY, {
        order_id,
        sku_id: item.sku_id,
        quantity: item.quantity,
      });
    }

    // 发送邮件通知
    await publishMessage(QUEUES.EMAIL_NOTIFICATION, {
      type: 'order_cancelled',
      user_id,
      order_id,
      subject: '订单已取消',
      content: `您的订单 ${order_id} 已取消，库存已恢复。`,
    });

    console.log(`✅ 订单取消消息处理完成: order_id=${order_id}`);
  } catch (error) {
    console.error('❌ 处理订单取消消息失败:', error);
    throw error;
  }
}

/**
 * 库存扣减消息处理器
 */
export async function handleStockDeduction(message: any) {
  const { order_id, sku_id, quantity } = message;
  
  console.log(`📉 处理库存扣减: sku_id=${sku_id}, quantity=${quantity}`);

  try {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // 扣减库存
      const [result] = await connection.execute(
        `UPDATE product_skus 
         SET stock = stock - ? 
         WHERE sku_id = ? AND stock >= ?`,
        [quantity, sku_id, quantity]
      );

      const affectedRows = (result as any).affectedRows;

      if (affectedRows === 0) {
        throw new Error(`库存不足: sku_id=${sku_id}`);
      }

      await connection.commit();
      console.log(`✅ 库存扣减成功: sku_id=${sku_id}, quantity=${quantity}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('❌ 库存扣减失败:', error);
    throw error;
  }
}

/**
 * 库存恢复消息处理器
 */
export async function handleStockRecovery(message: any) {
  const { order_id, sku_id, quantity } = message;
  
  console.log(`📈 处理库存恢复: sku_id=${sku_id}, quantity=${quantity}`);

  try {
    await pool.execute(
      `UPDATE product_skus 
       SET stock = stock + ? 
       WHERE sku_id = ?`,
      [quantity, sku_id]
    );

    console.log(`✅ 库存恢复成功: sku_id=${sku_id}, quantity=${quantity}`);
  } catch (error) {
    console.error('❌ 库存恢复失败:', error);
    throw error;
  }
}

/**
 * 邮件通知消息处理器（模拟）
 */
export async function handleEmailNotification(message: any) {
  const { type, user_id, subject, content } = message;
  
  console.log(`📧 模拟发送邮件通知:`);
  console.log(`   类型: ${type}`);
  console.log(`   用户: ${user_id}`);
  console.log(`   主题: ${subject}`);
  console.log(`   内容: ${content}`);

  // 这里应该调用真实的邮件服务
  // 例如: await sendEmail(user_email, subject, content);
  
  // 模拟邮件发送延迟
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log(`✅ 邮件通知已发送`);
}

/**
 * 订单超时检查消息处理器
 * 订单创建 30 分钟后触发：若订单仍未支付则自动取消并恢复库存
 */
export async function handleOrderTimeoutCheck(message: any) {
  const { order_id, user_id } = message;

  console.log(`⏰ 处理订单超时检查: order_id=${order_id}`);

  try {
    const cancelled = await cancelTimeoutOrder(order_id);

    if (!cancelled) {
      console.log(`⏭️ 订单 ${order_id} 无需取消（已支付或已取消）`);
      return;
    }

    // 发送超时取消通知邮件（模拟）
    await publishMessage(QUEUES.EMAIL_NOTIFICATION, {
      type: 'order_cancelled',
      user_id,
      order_id,
      subject: '订单已超时取消',
      content: `您的订单 ${order_id} 因超时未支付已自动取消，库存已恢复。`,
    });

    console.log(`✅ 订单超时取消处理完成: order_id=${order_id}`);
  } catch (error) {
    console.error('❌ 处理订单超时检查失败:', error);
    throw error;
  }
}

/**
 * 启动所有消息队列消费者
 */
export async function startMessageQueueConsumers() {
  try {
    console.log('🚀 启动消息队列消费者...');

    // 订单相关队列
    await consumeQueue(QUEUES.ORDER_CREATED, handleOrderCreated);
    await consumeQueue(QUEUES.ORDER_PAID, handleOrderPaid);
    await consumeQueue(QUEUES.ORDER_CANCELLED, handleOrderCancelled);
    await consumeQueue(QUEUES.ORDER_TIMEOUT_CHECK, handleOrderTimeoutCheck);

    // 库存相关队列
    await consumeQueue(QUEUES.STOCK_DEDUCTION, handleStockDeduction);
    await consumeQueue(QUEUES.STOCK_RECOVERY, handleStockRecovery);

    // 通知相关队列
    await consumeQueue(QUEUES.EMAIL_NOTIFICATION, handleEmailNotification);

    console.log('✅ 所有消息队列消费者已启动');
  } catch (error) {
    console.error('❌ 启动消息队列消费者失败:', error);
    throw error;
  }
}

/**
 * 发送订单超时检查消息（延迟 30 分钟投递）
 * 订单创建时调用；若 30 分钟后订单仍未支付，消费者将自动取消订单
 */
export async function sendOrderTimeoutCheckMessage(orderId: number, userId: number) {
  return await publishOrderTimeoutCheck(orderId, userId);
}

/**
 * 发送订单创建消息
 */
export async function sendOrderCreatedMessage(orderId: number, userId: number, items: any[]) {
  return await publishMessage(QUEUES.ORDER_CREATED, {
    order_id: orderId,
    user_id: userId,
    items,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 发送订单支付消息
 */
export async function sendOrderPaidMessage(orderId: number, userId: number) {
  return await publishMessage(QUEUES.ORDER_PAID, {
    order_id: orderId,
    user_id: userId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 发送订单取消消息
 */
export async function sendOrderCancelledMessage(orderId: number, userId: number, items: any[]) {
  return await publishMessage(QUEUES.ORDER_CANCELLED, {
    order_id: orderId,
    user_id: userId,
    items,
    timestamp: new Date().toISOString(),
  });
}

