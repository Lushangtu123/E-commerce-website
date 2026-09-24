import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { connectDatabase } from './database/mysql';
import { connectRedis } from './database/redis';
import { connectMongoDB } from './database/mongodb';
import { connectRabbitMQ } from './database/rabbitmq';
import { checkESConnection } from './database/elasticsearch';
import { startOrderTimeoutChecker } from './services/order-timeout.service';
import { startMessageQueueConsumers } from './services/message-queue.service';
import { apiLimiter } from './middleware/rate-limit';
import { requestLogger } from './middleware/request-logger';
import { getHealthReport } from './utils/health';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './utils/swagger';
import { getPool } from './database/mysql';
import { getRedisClient } from './database/redis';
import mongoose from './database/mongodb';
import { closeRabbitMQ } from './database/rabbitmq';

// 导入路由
import userRoutes from './routes/user.routes';
import productRoutes from './routes/product.routes';
import cartRoutes from './routes/cart.routes';
import orderRoutes from './routes/order.routes';
import reviewRoutes from './routes/review.routes';
import favoriteRoutes from './routes/favorite.routes';
import searchRoutes from './routes/search.routes';
import browseRoutes from './routes/browse.routes';
import recommendationRoutes from './routes/recommendation.routes';

// 管理员路由
import adminRoutes from './routes/admin.routes';
import adminProductRoutes from './routes/admin-product.routes';
import adminOrderRoutes from './routes/admin-order.routes';
import adminUserRoutes from './routes/admin-user.routes';
import adminCouponRoutes from './routes/admin-coupon.routes';

// 优惠券路由
import couponRoutes from './routes/coupon.routes';
import logger from './utils/logger';
import { validateEnv, getCorsOrigins } from './utils/validate-env';

dotenv.config();

// 启动前校验环境变量（生产环境缺失关键配置时拒绝启动）
validateEnv();

const app: Express = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(helmet()); // 安全头
app.use(cors({ origin: getCorsOrigins() })); // 跨域：CORS_ORIGIN 限制来源
app.use(compression()); // 压缩
app.use(express.json({ limit: '10mb' })); // JSON解析
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // URL编码解析

// 设置响应头字符编码
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// 静态文件
app.use('/uploads', express.static('uploads'));

// HTTP 请求日志
app.use(requestLogger);

// 健康检查（不计入限流）：依赖异常时返回 503
/**
 * @openapi
 * /health:
 *   get:
 *     tags: [运维]
 *     summary: 健康检查
 *     description: 返回 MySQL / Redis / MongoDB / RabbitMQ 的连通状态；任一依赖异常时返回 503
 *     responses:
 *       200:
 *         description: 所有依赖正常
 *       503:
 *         description: 存在异常依赖
 */
app.get('/health', async (req: Request, res: Response) => {
  const report = await getHealthReport();
  res.status(report.status === 'ok' ? 200 : 503).json(report);
});

// API 文档
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API 通用限流
app.use('/api', apiLimiter);

// API路由
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/browse', browseRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/coupons', couponRoutes);

// 管理员API路由
app.use('/api/admin', adminRoutes);
app.use('/api/admin/products', adminProductRoutes);
app.use('/api/admin/orders', adminOrderRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/coupons', adminCouponRoutes);

// 404处理
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: '接口不存在' });
});

// 错误处理中间件
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({ err }, '错误');
  res.status(500).json({ 
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 启动服务器
async function startServer() {
  try {
    // 连接数据库
    await connectDatabase();
    logger.info('✓ MySQL数据库连接成功');
    
    await connectRedis();
    logger.info('✓ Redis连接成功');
    
    await connectMongoDB();
    logger.info('✓ MongoDB连接成功');
    
    // 连接 RabbitMQ
    await connectRabbitMQ();
    logger.info('✓ RabbitMQ连接成功');
    
    // 检查 Elasticsearch 连接（不阻塞启动）
    checkESConnection().then((connected) => {
      if (connected) {
        logger.info('✓ Elasticsearch连接成功');
      } else {
        logger.warn('⚠️ Elasticsearch连接失败，搜索功能可能不可用');
      }
    });
    
    // 启动订单超时检查服务
    startOrderTimeoutChecker();
    logger.info('✓ 订单超时检查服务已启动');
    
    // 启动消息队列消费者
    await startMessageQueueConsumers();
    logger.info('✓ 消息队列消费者已启动');
    
    // 启动服务器
    const server = app.listen(PORT, () => {
      logger.info(`\n🚀 服务器运行在 http://localhost:${PORT}`);
      logger.info(`📝 环境: ${process.env.NODE_ENV}`);
      logger.info(`\n📚 新功能已启用:`);
      logger.info(`  • Elasticsearch 商品搜索`);
      logger.info(`  • RabbitMQ 消息队列`);
      logger.info(`  • 优惠券系统`);
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

      try {
        await mongoose.disconnect();
        logger.info('MongoDB 连接已关闭');
      } catch (err) {
        logger.error({ err }, '关闭 MongoDB 连接失败');
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

