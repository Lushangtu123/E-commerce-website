import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { checkAndCancelTimeoutOrders } from '../services/order-timeout.service';
import { purgeExpiredPersonalData } from '../services/data-retention.service';
import logger from '../utils/logger';

const router = Router();

/** Scheduled jobs authenticate with `Authorization: Bearer <CRON_SECRET>` (at least 32 characters). */
function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || secret.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: '未授权的定时任务' });
  }
  next();
}

router.post('/order-timeouts', requireCronSecret, async (_req, res) => {
  try {
    const result = await checkAndCancelTimeoutOrders(50);
    res.status(result.failed > 0 ? 503 : 200).json(result);
  }
  catch { logger.error('订单超时任务失败'); res.status(503).json({ error: '订单超时任务失败' }); }
});

/** Daily: deletes personal data past the retention periods of the privacy policy. */
router.post('/data-retention', requireCronSecret, async (_req, res) => {
  try {
    res.json(await purgeExpiredPersonalData());
  } catch (error) {
    logger.error({ err: error }, '数据保留清理失败');
    res.status(503).json({ error: '数据保留清理失败' });
  }
});
export default router;
