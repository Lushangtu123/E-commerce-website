import { Router } from 'express';
import { ProductController } from '../controllers/product.controller';

const router = Router();

// 获取分类列表（必须在 /:id 之前）
router.get('/categories', ProductController.getCategories);

// 获取热门商品（必须在 /:id 之前）
router.get('/hot', ProductController.getHotProducts);

// 获取商品列表
router.get('/', ProductController.list);

// 获取商品详情
router.get('/:id', ProductController.getDetail);

// 创建商品（管理员）
router.post('/', ProductController.create);

// 更新商品（管理员）
router.put('/:id', ProductController.update);

export default router;

