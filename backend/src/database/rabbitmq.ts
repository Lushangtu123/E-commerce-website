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

/** 未配置 RABBITMQ_URL 时不使用消息队列，订单超时取消由定时任务处理 */
export function isRabbitMQConfigured(): boolean {
  return Boolean(process.env.RABBITMQ_URL);
}

const RECONNECT_DELAY_MS = 5000;
let onConnected: (() => Promise<void>) | undefined;
let shuttingDown = false;

function scheduleReconnect() {
  if (!shuttingDown) setTimeout(() => { void connectRabbitMQ(); }, RECONNECT_DELAY_MS).unref();
}

/**
 * 连接到 RabbitMQ。可选依赖：失败时只记录日志并在后台重试，不会抛错或阻塞启动。
 * ready 在每次连接（含重连）成功后执行，用于重新注册消费者。
 */
export async function connectRabbitMQ(ready?: () => Promise<void>): Promise<void> {
  if (ready) onConnected = ready;
  if (!isRabbitMQConfigured()) {
    logger.info('未配置 RABBITMQ_URL，跳过 RabbitMQ，订单超时由定时任务取消');
    return;
  }
  try {
    logger.info('🐰 正在连接 RabbitMQ...');
    const conn = await amqp.connect(process.env.RABBITMQ_URL!);
    connection = conn as any;

    // 先注册事件：之后任何一步失败导致断开，都会经 close 事件重连
    conn.on('close', () => {
      connection = null;
      channel = null;
      if (shuttingDown) return;
      logger.warn('⚠️ RabbitMQ 连接已关闭，稍后重连');
      scheduleReconnect();
    });
    conn.on('error', (error) => {
      logger.error({ err: error }, '❌ RabbitMQ 连接错误');
    });

    try {
      const ch = await conn.createChannel();

      // 声明所有队列
      for (const queueName of Object.values(QUEUES)) {
        await ch.assertQueue(queueName, { durable: true });
      }

      // 声明订单超时检查延迟队列：消息 TTL 到期后死信路由到 order.timeout_check
      await ch.assertQueue(ORDER_TIMEOUT_DELAY_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': QUEUES.ORDER_TIMEOUT_CHECK,
        },
      });

      channel = ch;
      logger.info('✅ RabbitMQ 连接成功');
      await onConnected?.();
    } catch (error) {
      logger.error({ err: error }, '❌ RabbitMQ 初始化失败，断开后重连');
      channel = null;
      await conn.close().catch(() => undefined);
    }
  } catch (error) {
    logger.warn({ err: error }, '⚠️ 连接 RabbitMQ 失败，稍后重试；订单超时由定时任务兜底');
    scheduleReconnect();
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
  shuttingDown = true;
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

