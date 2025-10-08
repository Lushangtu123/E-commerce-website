import { Router } from 'express';
import { CartController } from '../controllers/cart.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 所有购物车接口都需要登录
router.use(authMiddleware);

// 获取购物车列表
router.get('/', CartController.list);

// 添加到购物车
router.post('/', CartController.add);

// 更新数量
router.put('/', CartController.updateQuantity);

// 删除商品
router.delete('/:id', CartController.remove);

// 清空购物车
router.delete('/', CartController.clear);

export default router;

