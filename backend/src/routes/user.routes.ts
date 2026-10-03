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
 *     description: 注册接口带防刷限流
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password]
 *             properties:
 *               username: { type: string, example: zhangsan }
 *               email: { type: string, format: email, example: zhangsan@example.com }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: 注册成功，返回用户信息与 Token
 *       400:
 *         description: 参数错误 / 邮箱已注册
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 *     description: 登录接口带防暴力破解限流
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: 登录成功，返回用户信息与 Token
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
 *             schema: { $ref: '#/components/schemas/User' }
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
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string }
 *               phone: { type: string }
 *               avatar_url: { type: string }
 *     responses:
 *       200:
 *         description: 更新成功
 *       401:
 *         description: 未登录或 Token 无效
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.put('/profile', authMiddleware, UserController.updateProfile);

export default router;
