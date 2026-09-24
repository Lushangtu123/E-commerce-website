import { Router } from 'express';
import { ProductController } from '../controllers/product.controller';

const router = Router();

/**
 * @openapi
 * /api/products/categories:
 *   get:
 *     tags: [商品]
 *     summary: 获取分类列表
 *     responses:
 *       200:
 *         description: 分类列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Category' }
 */
// 获取分类列表（必须在 /:id 之前）
router.get('/categories', ProductController.getCategories);

/**
 * @openapi
 * /api/products/hot:
 *   get:
 *     tags: [商品]
 *     summary: 获取热门商品
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *         description: 返回数量
 *     responses:
 *       200:
 *         description: 热门商品列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Product' }
 */
// 获取热门商品（必须在 /:id 之前）
router.get('/hot', ProductController.getHotProducts);

/**
 * @openapi
 * /api/products:
 *   get:
 *     tags: [商品]
 *     summary: 获取商品列表
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: category_id
 *         in: query
 *         schema: { type: integer }
 *         description: 按分类筛选
 *       - name: keyword
 *         in: query
 *         schema: { type: string }
 *       - name: min_price
 *         in: query
 *         schema: { type: number }
 *       - name: max_price
 *         in: query
 *         schema: { type: number }
 *       - name: sort
 *         in: query
 *         schema: { type: string }
 *         description: 排序字段，如 price / sales
 *     responses:
 *       200:
 *         description: 商品列表（分页）
 */
router.get('/', ProductController.list);

/**
 * @openapi
 * /api/products/{id}:
 *   get:
 *     tags: [商品]
 *     summary: 获取商品详情
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 商品详情
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Product' }
 *       404:
 *         description: 商品不存在
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id', ProductController.getDetail);

/**
 * @openapi
 * /api/products:
 *   post:
 *     tags: [商品]
 *     summary: 创建商品（管理员）
 *     deprecated: true
 *     description: 历史遗留接口，请使用管理后台接口 POST /api/admin/products
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/', ProductController.create);

/**
 * @openapi
 * /api/products/{id}:
 *   put:
 *     tags: [商品]
 *     summary: 更新商品（管理员）
 *     deprecated: true
 *     description: 历史遗留接口，请使用管理后台接口 PUT /api/admin/products/{productId}
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:id', ProductController.update);

export default router;
