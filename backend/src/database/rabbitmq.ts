import * as amqp from 'amqplib';
import logger from '../utils/logger';

let connection: amqp.Connection | null = null;
let channel: amqp.Channel | null = null;

// 队列名称
export const QUEUES = {
  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_TIMEOUT_CHECK: 'order.timeout_check',
  STOCK_DEDUCTION: 'stock.deduction',
  STOCK_RECOVERY: 'stock.recovery',
  EMAIL_NOTIFICATION: 'email.notification',
};

// 订单超时检查延迟队列：消息到期后经死信路由到真正的超时检查队列
// （使用 TTL + DLX 实现，无需 rabbitmq-delayed-message 插件）
const ORDER_TIMEOUT_DELAY_QUEUE = 'order.timeout_check.delay';
export const ORDER_TIMEOUT_DELAY_MS = 30 * 60 * 1000; // 30分钟，与订单超时配置一致

/**
 * 连接到 RabbitMQ
 */
export async function connectRabbitMQ(): Promise<void> {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq:5672';
    
    logger.info('🐰 正在连接 RabbitMQ...');
    const conn = await amqp.connect(rabbitmqUrl);
    connection = conn as any;
    channel = await conn.createChannel();

    // 声明所有队列
    for (const queueName of Object.values(QUEUES)) {
      await channel.assertQueue(queueName, { durable: true });
    }

    // 声明订单超时检查延迟队列：消息 TTL 到期后死信路由到 order.timeout_check
    await channel.assertQueue(ORDER_TIMEOUT_DELAY_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': QUEUES.ORDER_TIMEOUT_CHECK,
      },
    });

    logger.info('✅ RabbitMQ 连接成功');

    // 监听连接关闭事件（用局部 conn，已确保非空）
    conn.on('close', () => {
      logger.warn('⚠️ RabbitMQ 连接已关闭');
      setTimeout(connectRabbitMQ, 5000); // 5秒后重连
    });

    conn.on('error', (error) => {
      logger.error({ err: error }, '❌ RabbitMQ 连接错误');
    });
  } catch (error) {
    logger.error({ err: error }, '❌ 连接 RabbitMQ 失败');
    // 5秒后重试
    setTimeout(connectRabbitMQ, 5000);
  }
}

/**
 * 获取 RabbitMQ Channel
 */
export function getChannel(): amqp.Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel 未初始化');
  }
  return channel;
}

/**
 * 发布消息到队列
 */
export async function publishMessage(
  queueName: string,
  message: any
): Promise<boolean> {
  try {
    const ch = getChannel();
    const content = Buffer.from(JSON.stringify(message));
    
    return ch.sendToQueue(queueName, content, {
      persistent: true, // 持久化消息
    });
  } catch (error) {
    logger.error({ err: error }, `❌ 发布消息到队列 ${queueName} 失败`);
    return false;
  }
}

/**
 * 发布订单超时检查消息（延迟投递）
 * 订单创建时调用；delayMs 后消息经死信路由到 order.timeout_check 队列，
 * 消费者收到后若订单仍未支付则自动取消
 */
export async function publishOrderTimeoutCheck(
  orderId: number,
  userId: number,
  delayMs: number = ORDER_TIMEOUT_DELAY_MS
): Promise<boolean> {
  try {
    const ch = getChannel();
    const content = Buffer.from(
      JSON.stringify({
        order_id: orderId,
        user_id: userId,
        timestamp: new Date().toISOString(),
      })
    );

    return ch.sendToQueue(ORDER_TIMEOUT_DELAY_QUEUE, content, {
      persistent: true,
      expiration: String(delayMs),
    });
  } catch (error) {
    logger.error({ err: error }, '❌ 发布订单超时检查消息失败');
    return false;
  }
}

/**
 * 消费队列消息
 */
export async function consumeQueue(
  queueName: string,
  handler: (message: any) => Promise<void>
): Promise<void> {
  try {
    const ch = getChannel();
    
    await ch.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          logger.info({ content }, `📨 收到消息 [${queueName}]`);
          
          await handler(content);
          
          // 确认消息已处理
          ch.ack(msg);
          logger.info(`✅ 消息处理成功 [${queueName}]`);
        } catch (error) {
          logger.error({ err: error }, `❌ 处理消息失败 [${queueName}]`);
          // 拒绝消息并重新入队
          ch.nack(msg, false, true);
        }
      }
    });

    logger.info(`👂 开始监听队列: ${queueName}`);
  } catch (error) {
    logger.error({ err: error }, `❌ 消费队列 ${queueName} 失败`);
    throw error;
  }
}

/**
 * 关闭 RabbitMQ 连接
 */
export async function closeRabbitMQ(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await (connection as any).close();
      connection = null;
    }
    logger.info('✅ RabbitMQ 连接已关闭');
  } catch (error) {
    logger.error({ err: error }, '❌ 关闭 RabbitMQ 连接失败');
  }
}

export default {
  connect: connectRabbitMQ,
  getChannel,
  publishMessage,
  consumeQueue,
  close: closeRabbitMQ,
  QUEUES,
};

