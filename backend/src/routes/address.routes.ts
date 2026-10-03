import { Router } from 'express';
import { AddressController } from '../controllers/address.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);
/**
 * @openapi
 * /api/addresses:
 *   get:
 *     tags: [收货地址]
 *     summary: 获取当前用户收货地址
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 默认地址优先；is_default 为布尔值
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 addresses:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Address' }
 *       401: { description: 未登录 }
 *   post:
 *     tags: [收货地址]
 *     summary: 创建完整收货地址（每用户最多20条）
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       description: receiver_name、phone、province、city、district、detail_address 六项字符串必填；is_default 仅可选布尔值，拒绝未知字段及 user_id
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AddressInput' }
 *     responses:
 *       201: { description: 创建成功，返回 message 与 address_id }
 *       400: { description: 地址无效或超过20条上限 }
 *       401: { description: 未登录 }
 */
router.get('/', AddressController.list);
router.post('/', AddressController.create);
/**
 * @openapi
 * /api/addresses/{id}:
 *   put:
 *     tags: [收货地址]
 *     summary: 完整更新当前用户的收货地址
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer, minimum: 1, maximum: 9007199254740991 } }
 *     requestBody:
 *       required: true
 *       description: 六项地址字符串全部必填，is_default 仅可选布尔值，拒绝未知字段
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AddressInput' }
 *     responses:
 *       200: { description: 更新成功 }
 *       400: { description: 地址字段或ID无效 }
 *       401: { description: 未登录 }
 *       404: { description: 地址不存在或不属于当前用户 }
 *   delete:
 *     tags: [收货地址]
 *     summary: 删除当前用户的地址；删除默认地址后提升最小剩余ID
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer, minimum: 1, maximum: 9007199254740991 } }
 *     responses:
 *       200: { description: 删除成功；历史订单保留 }
 *       400: { description: 地址ID无效 }
 *       401: { description: 未登录 }
 *       404: { description: 地址不存在或不属于当前用户 }
 */
router.put('/:id', AddressController.update);
router.delete('/:id', AddressController.remove);

export default router;
