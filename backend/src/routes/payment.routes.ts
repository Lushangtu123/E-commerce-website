import { Router } from 'express';
import { getPaymentSettings } from '../utils/payment-settings';

const router = Router();
/**
 * @openapi
 * /api/payments/settings:
 *   get:
 *     tags: [订单]
 *     summary: 查询支付可用性；演示模式不会实际扣款，生产环境禁用
 *     responses:
 *       200:
 *         description: 公开的支付模式，不包含商户密钥
 */
router.get('/settings', (_req, res) => res.json(getPaymentSettings()));
export default router;
