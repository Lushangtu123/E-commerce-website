import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth';
import { authLimiter } from '../middleware/rate-limit';
import { passwordRecoveryLimiter } from '../middleware/password-recovery-limit';

const router = Router();

/**
 * @openapi
 * /api/users/password/capabilities:
 *   get:
 *     tags: [用户]
 *     summary: 获取密码找回可用状态和新密码规则
 *     responses:
 *       200:
 *         description: 不返回任何凭据，仅提供密码找回可用状态
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 passwordResetAvailable: { type: boolean }
 *                 passwordMinLength: { type: integer, example: 12 }
 *                 passwordMaxBytes: { type: integer, example: 72 }
 */
router.get('/password/capabilities', UserController.passwordCapabilities);

/**
 * @openapi
 * /api/users/password/forgot:
 *   post:
 *     tags: [用户]
 *     summary: 请求一次性密码重置邮件
 *     description: 每个IP每15分钟最多5次，包括成功请求。未知邮箱返回相同提示；邮件链接30分钟内有效，原文令牌不会写入数据库或接口响应。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             additionalProperties: false
 *             properties:
 *               email: { type: string, format: email, maxLength: 100 }
 *     responses:
 *       200: { description: 无论邮箱是否存在均返回相同提示，不保证邮箱可投递 }
 *       400: { description: 邮箱字段无效 }
 *       429: { description: 超过找回请求限额 }
 *       503: { description: 邮件配置缺失或密码找回暂不可用 }
 */
router.post('/password/forgot', passwordRecoveryLimiter, UserController.forgotPassword);

/**
 * @openapi
 * /api/users/password/reset:
 *   post:
 *     tags: [用户]
 *     summary: 使用一次性凭据重置密码并撤销全部现有用户会话
 *     description: 需携带 X-Requested-With 请求头；有 Origin 时须为当前部署或明确允许的规范 HTTP(S) 来源。无 Origin 的 API 客户端仍需请求头。来源无效时不消费凭据或清除 Cookie。
 *     parameters:
 *       - { in: header, name: X-Requested-With, required: true, schema: { type: string, example: XMLHttpRequest } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             additionalProperties: false
 *             properties:
 *               token: { type: string, pattern: '^[a-f0-9]{64}$' }
 *               newPassword: { type: string, format: password, minLength: 12, description: 最多72个UTF-8字节，不去除空白 }
 *     responses:
 *       200: { description: 密码已更新，所有旧会话和重置链接失效，必须重新登录 }
 *       400: { description: 密码无效或重置凭据已过期、已使用 }
 *       403: { description: 请求来源校验失败 }
 *       429: { description: 超过密码验证尝试限额 }
 *       503: { description: 密码重置暂不可用 }
 */
router.post('/password/reset', authLimiter, UserController.resetPassword);

/**
 * @openapi
 * /api/users/password:
 *   put:
 *     tags: [用户]
 *     summary: 验证当前密码并修改密码，撤销全部现有用户会话
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             additionalProperties: false
 *             properties:
 *               currentPassword: { type: string, format: password, minLength: 1 }
 *               newPassword: { type: string, format: password, minLength: 12, description: 最多72个UTF-8字节，不去除空白 }
 *     responses:
 *       200: { description: 密码已修改，必须重新登录 }
 *       400: { description: 当前密码错误或新密码无效 }
 *       401: { description: 用户令牌无效或已撤销 }
 *       409: { description: 并发密码修改，请重新登录 }
 *       429: { description: 超过密码验证尝试限额 }
 *       503: { description: 密码修改暂不可用 }
 */
router.put('/password', authMiddleware, authLimiter, UserController.changePassword);

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
 *     description: 带防刷限流；用户名和邮箱去除首尾空白，密码保留原文且最多72个UTF-8字节，拒绝额外字段。需携带 X-Requested-With；有 Origin 时须为当前部署或明确允许的规范 HTTP(S) 来源，无 Origin 的 API 客户端也需请求头。
 *     parameters:
 *       - { in: header, name: X-Requested-With, required: true, schema: { type: string, example: XMLHttpRequest } }
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
 *               password: { type: string, format: password, minLength: 12, description: 最多72个UTF-8字节，不去除空白 }
 *     responses:
 *       201:
 *         description: 注册成功，返回用户信息并设置 customer_session Cookie
 *       400:
 *         description: 字段、类型或长度错误
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: 请求来源校验失败
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
 *     description: 带防暴力破解限流；邮箱去除首尾空白，密码保留原文，不对旧账户套用新注册密码长度规则。需携带 X-Requested-With；有 Origin 时须为当前部署或明确允许的规范 HTTP(S) 来源，无 Origin 的 API 客户端也需请求头。
 *     parameters:
 *       - { in: header, name: X-Requested-With, required: true, schema: { type: string, example: XMLHttpRequest } }
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
 *         description: 登录成功，返回用户信息并设置 customer_session Cookie
 *       400:
 *         description: 字段或类型错误
 *       401:
 *         description: 邮箱或密码错误
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: 请求来源校验失败或账号已被禁用
 *       429:
 *         description: 触发登录防爆破限流
 */
router.post('/login', authLimiter, UserController.login);

/**
 * @openapi
 * /api/users/logout:
 *   post:
 *     tags: [用户]
 *     summary: 退出登录
 *     description: 清除 httpOnly 会话 Cookie。需带 X-Requested-With 请求头；有 Origin 时须为当前部署或明确允许的规范 HTTP(S) 来源，无 Origin 的 API 客户端也需请求头。
 *     parameters:
 *       - { in: header, name: X-Requested-With, required: true, schema: { type: string, example: XMLHttpRequest } }
 *     responses:
 *       200:
 *         description: 已清除会话 Cookie
 *       403:
 *         description: 请求来源校验失败，不清除 Cookie
 */
router.post('/logout', UserController.logout);

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
