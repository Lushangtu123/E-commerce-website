import './load-env';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { apiLimiter } from './middleware/rate-limit';
import { requestLogger } from './middleware/request-logger';
import { getHealthReport } from './utils/health';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './utils/openapi';

// 导入路由
import userRoutes from './routes/user.routes';
import productRoutes from './routes/product.routes';
import cartRoutes from './routes/cart.routes';
import orderRoutes from './routes/order.routes';
import addressRoutes from './routes/address.routes';
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
import internalRoutes from './routes/internal.routes';
import paymentRoutes from './routes/payment.routes';
import afterSalesRoutes from './routes/after-sales.routes';
import adminAfterSalesRoutes from './routes/admin-after-sales.routes';
import logger from './utils/logger';
import { validateEnv, corsOptions } from './utils/validate-env';

export function createApp(options: { serverless?: boolean } = {}): Express {
  validateEnv();
  const app: Express = express();
  if (process.env.VERCEL) app.set('trust proxy', 1);

  // 中间件
  app.use(helmet()); // 安全头
  app.use(cors(corsOptions())); // 跨域：CORS_ORIGIN 限制来源，只有列出的来源能带会话 Cookie
  app.use(compression()); // 压缩
  // 请求体上限：最大的合法请求（批量创建 100 个 SKU）约 350KB
  app.use(express.json({ limit: '1mb' })); // JSON解析
  app.use(express.urlencoded({ extended: true, limit: '1mb' })); // URL编码解析
  // Express 5 不解析请求体时 req.body 为 undefined；保持 v4 的空对象约定，缺少字段时由校验返回 400 而不是 500
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.body ??= {};
    next();
  });

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
   *     description: 返回 MySQL / Redis 及已配置的 RabbitMQ / Elasticsearch 的连通状态；MySQL 或 Redis 异常时返回 503，可选依赖异常只标记为 down
   *     responses:
   *       200:
   *         description: 必需依赖正常
   *       503:
   *         description: MySQL 或 Redis 异常
   */
  app.get(['/health', '/api/health'], async (req: Request, res: Response) => {
    const report = await getHealthReport(options.serverless);
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  // API 文档
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/openapi.json', (_req, res) => res.json(swaggerSpec));

  // API 通用限流
  app.use('/api/internal', internalRoutes);
  app.use('/api', apiLimiter);

  // API路由
  app.use('/api/users', userRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/orders', afterSalesRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/addresses', addressRoutes);
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
  app.use('/api/admin/after-sales', adminAfterSalesRoutes);
  app.use('/api/admin/users', adminUserRoutes);
  app.use('/api/admin/coupons', adminCouponRoutes);

  // 404处理
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: '接口不存在' });
  });

  // 错误处理中间件
  app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, next: NextFunction) => {
    // 请求体解析错误是客户端问题，不按服务器错误处理
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求格式无效' });
    logger.error({ err }, '错误');
    res.status(500).json({
      error: '服务器内部错误',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });


  return app;
}
