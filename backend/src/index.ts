import './load-env';
import { createApp } from './app';
import logger from './utils/logger';
import { connectDatabase } from './database/mysql';
import { connectRedis } from './database/redis';
import { connectRabbitMQ } from './database/rabbitmq';
import { checkESConnection, getESClient } from './database/elasticsearch';
import { startOrderTimeoutChecker } from './services/order-timeout.service';
import { startMessageQueueConsumers } from './services/message-queue.service';
import { getPool } from './database/mysql';
import { getRedisClient } from './database/redis';
import { closeRabbitMQ } from './database/rabbitmq';
const app = createApp();
const PORT = process.env.PORT || 3001;

// 启动服务器
async function startServer() {
  try {
    // 连接数据库
    await connectDatabase();
    logger.info('✓ MySQL数据库连接成功');
    
    await connectRedis();
    logger.info('✓ Redis连接成功');
    
    // 可选依赖：连接失败或未配置都不阻塞启动
    // RabbitMQ 每次（重）连成功后注册消费者；不可用时订单超时由定时任务取消
    await connectRabbitMQ(startMessageQueueConsumers);

    // Elasticsearch 不可用时商品搜索回退到 MySQL
    if (getESClient()) {
      checkESConnection().then((connected) => {
        if (connected) {
          logger.info('✓ Elasticsearch连接成功');
        } else {
          logger.warn('⚠️ Elasticsearch连接失败，商品搜索将回退到 MySQL');
        }
      });
    } else {
      logger.info('未配置 ELASTICSEARCH_URL，商品搜索使用 MySQL');
    }
    
    // 启动订单超时检查服务
    startOrderTimeoutChecker();
    logger.info('✓ 订单超时检查服务已启动');
    
    // 启动服务器
    const server = app.listen(PORT, () => {
      logger.info(`\n🚀 服务器运行在 http://localhost:${PORT}`);
      logger.info(`📝 环境: ${process.env.NODE_ENV}`);
    });

    // 优雅关闭：先停新连接，再关各依赖连接
    gracefulShutdown(server);
  } catch (error) {
    logger.error({ err: error }, '启动失败');
    process.exit(1);
  }
}

startServer();

/** 优雅关闭超时兜底（毫秒） */
const SHUTDOWN_TIMEOUT_MS = 10000;

/**
 * 优雅关闭：停止接受新连接 → 等待已有请求完成 → 依次关闭各依赖连接
 * 各依赖关闭互不影响，单个失败只记日志不中断流程
 */
function gracefulShutdown(server: import('http').Server) {
  const shutdown = async (signal: string) => {
    logger.info(`收到 ${signal}，开始优雅关闭...`);

    // 超时兜底：10 秒内未完成则强制退出
    const forceTimer = setTimeout(() => {
      logger.error('优雅关闭超时，强制退出');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      // 1. 停止接受新连接，等待已有请求处理完
      await new Promise<void>((resolve) => server.close(() => resolve()));
      logger.info('HTTP 服务已停止接受新连接');

      // 2. 依次关闭依赖连接
      await closeRabbitMQ();

      try {
        await getPool().end();
        logger.info('MySQL 连接池已关闭');
      } catch (err) {
        logger.error({ err }, '关闭 MySQL 连接池失败');
      }

      try {
        getRedisClient().disconnect();
        logger.info('Redis 连接已关闭');
      } catch (err) {
        logger.error({ err }, '关闭 Redis 连接失败');
      }

      clearTimeout(forceTimer);
      logger.info('优雅关闭完成');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, '优雅关闭过程出错');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
