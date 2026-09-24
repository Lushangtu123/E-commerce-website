import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth';
import { authLimiter } from '../middleware/rate-limit';

const router = Router();

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
