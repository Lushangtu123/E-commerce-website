import express from 'express';
import {
  getAdminProducts,
  updateProductStatus,
  batchUpdateProductStatus,
  createProduct,
  updateProduct,
  deleteProduct
} from '../controllers/admin-product.controller';
import { authenticateAdmin, requirePermission } from '../middleware/admin-auth';

const router = express.Router();

// 所有路由都需要管理员认证
router.use(authenticateAdmin);

// 获取商品列表
router.get('/', requirePermission('product:view'), getAdminProducts);

// 创建商品
router.post('/', requirePermission('product:create'), createProduct);

// 更新商品信息
router.put('/:productId', requirePermission('product:edit'), updateProduct);

// 更新商品状态
router.put('/:productId/status', requirePermission('product:edit'), updateProductStatus);

// 批量更新商品状态
router.put('/batch/status', requirePermission('product:edit'), batchUpdateProductStatus);

// 删除商品
router.delete('/:productId', requirePermission('product:delete'), deleteProduct);

export default router;

