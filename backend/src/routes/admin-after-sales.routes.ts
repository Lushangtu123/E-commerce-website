import { Router } from 'express';
import { authenticateAdmin, requirePermission } from '../middleware/admin-auth';
import { getAdminAfterSales, reviewAdminAfterSales, completeAdminAfterSales } from '../controllers/after-sales.controller';
const router = Router();
router.use(authenticateAdmin);
/**
 * @openapi
 * /api/admin/after-sales:
 *   get:
 *     tags: [管理后台-售后]
 *     summary: 分页查询售后申请，需 order:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, minimum: 1, maximum: 1000000, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { name: status, in: query, schema: { type: string, enum: [requested, approved, rejected, withdrawn] } }
 *     responses:
 *       200: { description: requests 与 pagination }
 *       400: { description: 查询参数无效 }
 */
router.get('/', requirePermission('order:view'), getAdminAfterSales);
/**
 * @openapi
 * /api/admin/after-sales/{id}/review:
 *   post:
 *     tags: [管理后台-售后]
 *     summary: 审核待审核售后申请，需 order:edit 权限
 *     description: 审核和操作审计原子写入。审核通过不表示钱款已退回，不修改订单状态或库存。
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer, minimum: 1 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [status, note]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *               note: { type: string, minLength: 1, maxLength: 500 }
 *     responses:
 *       200: { description: 审核完成，返回 after_sales }
 *       400: { description: 参数无效 }
 *       404: { description: 申请不存在 }
 *       409: { description: 申请不处于待审核状态 }
 */
router.post('/:id/review', requirePermission('order:edit'), reviewAdminAfterSales);
/**
 * @openapi
 * /api/admin/after-sales/{id}/complete:
 *   post:
 *     tags: [管理后台-售后]
 *     summary: 记录已完成的人工处理并结案，需 order:edit 权限
 *     description: 不调用支付渠道或回补库存。退款金额不得超过订单实付金额；演示订单仅允许零金额。非零退款需凭证，退货申请需已有退货运单。
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer, minimum: 1 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [refund_amount, note]
 *             properties:
 *               refund_amount: { type: string, pattern: '^\d+(\.\d{1,2})?$' }
 *               refund_reference: { type: string, minLength: 1, maxLength: 100 }
 *               note: { type: string, minLength: 1, maxLength: 500 }
 *     responses:
 *       200: { description: 结案记录已保存，返回 after_sales }
 *       400: { description: 参数或退款金额无效 }
 *       403: { description: 无权限 }
 *       404: { description: 申请不存在 }
 *       409: { description: 尚未批准、退货运单缺失或已经结案 }
 */
router.post('/:id/complete', requirePermission('order:edit'), completeAdminAfterSales);
export default router;
