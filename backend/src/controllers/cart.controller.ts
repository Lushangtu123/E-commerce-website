import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { CartModel } from '../models/cart.model';

export class CartController {
  // 获取购物车列表
  static async list(req: AuthRequest, res: Response) {
    try {
      const items = await CartModel.list(req.userId!);
      
      res.json({ items });
    } catch (error) {
      console.error('获取购物车失败:', error);
      res.status(500).json({ error: '获取购物车失败' });
    }
  }

  // 添加到购物车
  static async add(req: AuthRequest, res: Response) {
    try {
      const { product_id, quantity = 1 } = req.body;

      if (!product_id) {
        return res.status(400).json({ error: '缺少商品ID' });
      }

      const success = await CartModel.add(req.userId!, product_id, quantity);

      if (success) {
        res.json({ message: '添加成功' });
      } else {
        res.status(400).json({ error: '添加失败' });
      }
    } catch (error) {
      console.error('添加购物车失败:', error);
      res.status(500).json({ error: '添加购物车失败' });
    }
  }

  // 更新数量
  static async updateQuantity(req: AuthRequest, res: Response) {
    try {
      const { product_id, quantity } = req.body;

      if (!product_id || quantity === undefined) {
        return res.status(400).json({ error: '参数错误' });
      }

      const success = await CartModel.updateQuantity(req.userId!, product_id, quantity);

      if (success) {
        res.json({ message: '更新成功' });
      } else {
        res.status(400).json({ error: '更新失败' });
      }
    } catch (error) {
      console.error('更新购物车失败:', error);
      res.status(500).json({ error: '更新购物车失败' });
    }
  }

  // 删除商品
  static async remove(req: AuthRequest, res: Response) {
    try {
      const productId = parseInt(req.params.id);

      const success = await CartModel.remove(req.userId!, productId);

      if (success) {
        res.json({ message: '删除成功' });
      } else {
        res.status(400).json({ error: '删除失败' });
      }
    } catch (error) {
      console.error('删除购物车商品失败:', error);
      res.status(500).json({ error: '删除购物车商品失败' });
    }
  }

  // 清空购物车
  static async clear(req: AuthRequest, res: Response) {
    try {
      const success = await CartModel.clear(req.userId!);

      if (success) {
        res.json({ message: '清空成功' });
      } else {
        res.status(400).json({ error: '清空失败' });
      }
    } catch (error) {
      console.error('清空购物车失败:', error);
      res.status(500).json({ error: '清空购物车失败' });
    }
  }
}

