import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth';
import { authLimiter } from '../middleware/rate-limit';

const router = Router();

/**
 * @openapi
 * /api/users/stats:
 *   get:
 *     tags: [用户]
 *     summary: 获取当前登录用户的个人统计
 *     description: 可用券统计按状态与有效期、合法规则判断，不依赖订单金额门槛
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 五项用户统计，不接受其他用户ID指定
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [stats]
 *               properties:
 *                 stats:
 *                   type: object
 *                   required: [totalOrders, pendingOrders, totalCoupons, availableCoupons, favoriteCount]
 *                   properties:
 *                     totalOrders: { type: integer, minimum: 0 }
 *                     pendingOrders: { type: integer, minimum: 0 }
 *                     totalCoupons: { type: integer, minimum: 0 }
 *                     availableCoupons: { type: integer, minimum: 0 }
 *                     favoriteCount: { type: integer, minimum: 0 }
 *       401: { description: 未登录或用户Token无效 }
 *       404: { description: 用户不存在 }
 */
router.get('/stats', authMiddleware, UserController.getStats);

/**
 * @openapi
 * /api/users/register:
 *   post:
 *     tags: [用户]
 *     summary: 用户注册
 *     description: 带防刷限流；用户名和邮箱去除首尾空白，密码保留原文且最多72个UTF-8字节，拒绝额外字段
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password]
 *             additionalProperties: false
 *             properties:
 *               username: { type: string, minLength: 1, maxLength: 50, example: zhangsan }
 *               email: { type: string, format: email, maxLength: 100, example: zhangsan@example.com }
 *               password: { type: string, format: password, minLength: 6, description: 最多72个UTF-8字节，不去除空白 }
 *     responses:
 *       201:
 *         description: 注册成功，返回用户信息与 Token
 *       400:
 *         description: 字段、类型或长度错误
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: 用户名或邮箱已被使用，包括并发注册冲突
 *       429:
 *         description: 触发注册防刷限流
 */
router.post('/register', authLimiter, UserController.register);

/**
 * @openapi
 * /api/users/login:
 *   post:
 *     tags: [用户]
 *     summary: 用户登录
 *     description: 带防暴力破解限流；邮箱去除首尾空白，密码保留原文，不对旧账户套用新注册密码长度规则
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             additionalProperties: false
 *             properties:
 *               email: { type: string, minLength: 1, maxLength: 100 }
 *               password: { type: string, format: password, minLength: 1 }
 *     responses:
 *       200:
 *         description: 登录成功，返回用户信息与 Token
 *       400:
 *         description: 字段或类型错误
 *       401:
 *         description: 邮箱或密码错误
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: 触发登录防爆破限流
 */
router.post('/login', authLimiter, UserController.login);

/**
 * @openapi
 * /api/users/profile:
 *   get:
 *     tags: [用户]
 *     summary: 获取个人信息
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 当前登录用户信息
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { $ref: '#/components/schemas/User' }
 *       404:
 *         description: 用户不存在
 *       401:
 *         description: 未登录或 Token 无效
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/profile', authMiddleware, UserController.getProfile);

/**
 * @openapi
 * /api/users/profile:
 *   put:
 *     tags: [用户]
 *     summary: 更新个人信息
 *     description: 至少提供一个允许字段；字符串去除首尾空白，手机号和头像用空字符串或null清空；拒绝邮箱、密码和额外字段
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             additionalProperties: false
 *             properties:
 *               username: { type: string, minLength: 1, maxLength: 50 }
 *               phone: { type: string, maxLength: 20, nullable: true }
 *               avatar_url: { type: string, format: uri, maxLength: 255, nullable: true, description: HTTP(S)网址，或空字符串/null清空 }
 *     responses:
 *       200:
 *         description: 更新成功，返回message和公开user资料；提交已有值也成功
 *       400:
 *         description: 空更新或字段无效
 *       404:
 *         description: 用户不存在
 *       409:
 *         description: 用户名已被使用
 *       401:
 *         description: 未登录或 Token 无效
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.put('/profile', authMiddleware, UserController.updateProfile);

export default router;
