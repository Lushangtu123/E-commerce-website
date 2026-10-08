import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { checkAndCancelTimeoutOrders } from '../services/order-timeout.service';
import logger from '../utils/logger';

const router = Router();
router.post('/order-timeouts', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || secret.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: '未授权的定时任务' });
  }
  try {
    const result = await checkAndCancelTimeoutOrders(50);
    res.status(result.failed > 0 ? 503 : 200).json(result);
  }
  catch { logger.error('订单超时任务失败'); res.status(503).json({ error: '订单超时任务失败' }); }
});
export default router;
