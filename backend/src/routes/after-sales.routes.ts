import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getCustomerAfterSales, createCustomerAfterSales, withdrawCustomerAfterSales } from '../controllers/after-sales.controller';
const router = Router();
/**
 * @openapi
 * /api/orders/{id}/after-sales:
 *   get:
 *     tags: [订单售后]
 *     summary: 获取当前用户订单的售后申请
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer, minimum: 1 } }
 *     responses:
 *       200: { description: after_sales 为申请记录或 null }
 *       404: { description: 订单不存在或不属于当前用户 }
 *   post:
 *     tags: [订单售后]
 *     summary: 为已支付、已发货或已完成订单提交售后申请
 *     description: 每订单最多一次申请；审核仅表示审核通过，不会执行退款或库存回补。
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer, minimum: 1 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [type, reason]
 *             properties:
 *               type: { type: string, enum: [refund, return] }
 *               reason: { type: string, minLength: 1, maxLength: 500 }
 *     responses:
 *       201: { description: 申请提交成功，返回 after_sales }
 *       400: { description: 输入或订单状态无效 }
 *       409: { description: 该订单已有申请 }
 */
router.get('/:id/after-sales', authMiddleware, getCustomerAfterSales);
router.post('/:id/after-sales', authMiddleware, createCustomerAfterSales);
/**
 * @openapi
 * /api/orders/{id}/after-sales/withdraw:
 *   post:
 *     tags: [订单售后]
 *     summary: 撤回当前用户尚未审核的售后申请
 *     description: 已撤回申请保留历史记录，禁止重复申请。
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer, minimum: 1 } }
 *     responses:
 *       200: { description: 已撤回，返回 after_sales }
 *       404: { description: 订单或售后申请不存在 }
 *       409: { description: 申请已经审核或撤回 }
 */
router.post('/:id/after-sales/withdraw', authMiddleware, withdrawCustomerAfterSales);
export default router;
