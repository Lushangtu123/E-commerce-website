import express from 'express';
import {
  getAdminProducts,
  updateProductStatus,
  batchUpdateProductStatus,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductSKUs,
  createSKU,
  batchCreateSKUs,
  updateSKU,
  deleteSKU
} from '../controllers/admin-product.controller';
import { authenticateAdmin, requirePermission } from '../middleware/admin-auth';

const router = express.Router();

// 所有路由都需要管理员认证
router.use(authenticateAdmin);

/**
 * @openapi
 * /api/admin/products:
 *   get:
 *     tags: [管理后台-商品]
 *     summary: 获取商品列表
 *     description: 需要 product:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: 商品列表（分页）
 */
router.get('/', requirePermission('product:view'), getAdminProducts);

/**
 * @openapi
 * /api/admin/products:
 *   post:
 *     tags: [管理后台-商品]
 *     summary: 创建商品
 *     description: 需要 product:create 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, price]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               stock: { type: integer }
 *               category_id: { type: integer }
 *               image_url: { type: string }
 *               brand: { type: string }
 *               status: { type: integer, description: '1 上架，0 下架' }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/', requirePermission('product:create'), createProduct);

/**
 * @openapi
 * /api/admin/products/batch/status:
 *   put:
 *     tags: [管理后台-商品]
 *     summary: 批量更新商品状态
 *     description: 需要 product:edit 权限；注意注册顺序必须在 /{productId}/status 之前，否则会被影子路由吞掉
 *     security: [{ adminAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productIds, status]
 *             properties:
 *               productIds:
 *                 type: array
 *                 items: { type: integer }
 *               status: { type: integer, description: '1 上架，0 下架' }
 *     responses:
 *       200:
 *         description: 批量更新成功
 */
router.put('/batch/status', requirePermission('product:edit'), batchUpdateProductStatus);

/**
 * @openapi
 * /api/admin/products/{productId}:
 *   put:
 *     tags: [管理后台-商品]
 *     summary: 更新商品信息
 *     description: 需要 product:edit 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: productId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               price: { type: number }
 *               stock: { type: integer }
 *               category_id: { type: integer }
 *               image_url: { type: string }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:productId', requirePermission('product:edit'), updateProduct);

/**
 * @openapi
 * /api/admin/products/{productId}/status:
 *   put:
 *     tags: [管理后台-商品]
 *     summary: 更新商品上下架状态
 *     description: 需要 product:edit 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: productId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: integer, description: '1 上架，0 下架' }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/:productId/status', requirePermission('product:edit'), updateProductStatus);

/**
 * @openapi
 * /api/admin/products/{productId}:
 *   delete:
 *     tags: [管理后台-商品]
 *     summary: 删除商品
 *     description: 需要 product:delete 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: productId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/:productId', requirePermission('product:delete'), deleteProduct);

// ==================== SKU 管理路由 ====================

/**
 * @openapi
 * /api/admin/products/{productId}/skus:
 *   get:
 *     tags: [管理后台-商品]
 *     summary: 获取商品的所有 SKU
 *     description: 需要 product:view 权限
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: productId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: SKU 列表
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Sku' }
 */
router.get('/:productId/skus', requirePermission('product:view'), getProductSKUs);

/**
 * @openapi
 * /api/admin/products/{productId}/skus:
 *   post:
 *     tags: [管理后台-商品]
 *     summary: 创建 SKU
 *     description: 需要 product:create 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: productId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sku_code, price, stock]
 *             properties:
 *               sku_code: { type: string }
 *               specs:
 *                 type: object
 *                 example: { 颜色: 红, 尺码: M }
 *               price: { type: number }
 *               original_price: { type: number }
 *               stock: { type: integer }
 *               image: { type: string }
 *     responses:
 *       200:
 *         description: 创建成功
 */
router.post('/:productId/skus', requirePermission('product:create'), createSKU);

/**
 * @openapi
 * /api/admin/products/{productId}/skus/batch:
 *   post:
 *     tags: [管理后台-商品]
 *     summary: 批量创建 SKU
 *     description: 需要 product:create 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: productId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skus]
 *             properties:
 *               skus:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [sku_code, price, stock]
 *                   properties:
 *                     sku_code: { type: string }
 *                     specs: { type: object }
 *                     price: { type: number }
 *                     original_price: { type: number }
 *                     stock: { type: integer }
 *                     image: { type: string }
 *     responses:
 *       200:
 *         description: 批量创建成功
 */
router.post('/:productId/skus/batch', requirePermission('product:create'), batchCreateSKUs);

/**
 * @openapi
 * /api/admin/products/skus/{skuId}:
 *   put:
 *     tags: [管理后台-商品]
 *     summary: 更新 SKU
 *     description: 需要 product:edit 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: skuId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               specs: { type: object }
 *               price: { type: number }
 *               original_price: { type: number }
 *               stock: { type: integer }
 *               image: { type: string }
 *               status: { type: integer }
 *     responses:
 *       200:
 *         description: 更新成功
 */
router.put('/skus/:skuId', requirePermission('product:edit'), updateSKU);

/**
 * @openapi
 * /api/admin/products/skus/{skuId}:
 *   delete:
 *     tags: [管理后台-商品]
 *     summary: 删除 SKU
 *     description: 需要 product:delete 权限，操作记审计日志
 *     security: [{ adminAuth: [] }]
 *     parameters:
 *       - name: skuId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 删除成功
 */
router.delete('/skus/:skuId', requirePermission('product:delete'), deleteSKU);

export default router;
