import { Response } from 'express';
import { BrowseHistoryModel } from '../models/browse-history.model';
import { AuthRequest } from '../middleware/auth';

// 添加浏览记录
export const recordBrowse = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_id } = req.body;

    if (!product_id) {
      return res.status(400).json({ message: '商品ID不能为空' });
    }

    const id = await BrowseHistoryModel.add(userId, product_id);

    res.json({ message: '记录成功', id });
  } catch (error) {
    console.error('记录浏览历史失败:', error);
    res.status(500).json({ message: '记录浏览历史失败' });
  }
};

// 获取用户浏览历史
export const getUserBrowseHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const { history, total } = await BrowseHistoryModel.getUserHistory(userId, page, limit);

    res.json({
      history,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取浏览历史失败:', error);
    res.status(500).json({ message: '获取浏览历史失败' });
  }
};

// 清除用户浏览历史
export const clearBrowseHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    const success = await BrowseHistoryModel.clearUserHistory(userId);

    res.json({ 
      message: success ? '清除成功' : '暂无浏览历史',
      cleared: success 
    });
  } catch (error) {
    console.error('清除浏览历史失败:', error);
    res.status(500).json({ message: '清除浏览历史失败' });
  }
};

// 删除单条浏览记录
export const deleteBrowseRecord = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { product_id } = req.params;

    const success = await BrowseHistoryModel.deleteRecord(userId, Number(product_id));

    if (!success) {
      return res.status(404).json({ message: '浏览记录不存在' });
    }

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除浏览记录失败:', error);
    res.status(500).json({ message: '删除浏览记录失败' });
  }
};

