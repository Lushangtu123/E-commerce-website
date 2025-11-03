import * as amqp from 'amqplib';

let connection: amqp.Connection | null = null;
let channel: amqp.Channel | null = null;

// 队列名称
export const QUEUES = {
  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_CANCELLED: 'order.cancelled',
  STOCK_DEDUCTION: 'stock.deduction',
  STOCK_RECOVERY: 'stock.recovery',
  EMAIL_NOTIFICATION: 'email.notification',
};

/**
 * 连接到 RabbitMQ
 */
export async function connectRabbitMQ(): Promise<void> {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://admin:admin123@rabbitmq:5672';
    
    console.log('🐰 正在连接 RabbitMQ...');
    const conn = await amqp.connect(rabbitmqUrl);
    connection = conn as any;
    channel = await conn.createChannel();

    // 声明所有队列
    for (const queueName of Object.values(QUEUES)) {
      await channel.assertQueue(queueName, { durable: true });
    }

    console.log('✅ RabbitMQ 连接成功');

    // 监听连接关闭事件
    connection.on('close', () => {
      console.warn('⚠️ RabbitMQ 连接已关闭');
      setTimeout(connectRabbitMQ, 5000); // 5秒后重连
    });

    connection.on('error', (error) => {
      console.error('❌ RabbitMQ 连接错误:', error);
    });
  } catch (error) {
    console.error('❌ 连接 RabbitMQ 失败:', error);
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
    console.error(`❌ 发布消息到队列 ${queueName} 失败:`, error);
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
          console.log(`📨 收到消息 [${queueName}]:`, content);
          
          await handler(content);
          
          // 确认消息已处理
          ch.ack(msg);
          console.log(`✅ 消息处理成功 [${queueName}]`);
        } catch (error) {
          console.error(`❌ 处理消息失败 [${queueName}]:`, error);
          // 拒绝消息并重新入队
          ch.nack(msg, false, true);
        }
      }
    });

    console.log(`👂 开始监听队列: ${queueName}`);
  } catch (error) {
    console.error(`❌ 消费队列 ${queueName} 失败:`, error);
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
    console.log('✅ RabbitMQ 连接已关闭');
  } catch (error) {
    console.error('❌ 关闭 RabbitMQ 连接失败:', error);
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

