import { Response } from 'express';
import { BrowseHistoryModel } from '../models/browse-history.model';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { CustomerActivityError, activityListSchema, activityProductSchema, activityPathId } from '../utils/customer-activity-validation';

// 添加浏览记录
export const recordBrowse = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { error, value } = activityProductSchema.validate(req.body);
    if (error) return res.status(400).json({ message: '商品ID或字段无效' });
    const id = await BrowseHistoryModel.add(userId, value.product_id);

    res.json({ message: '记录成功', id });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '记录浏览历史失败');
    res.status(500).json({ message: '记录浏览历史失败' });
  }
};

// 获取用户浏览历史
export const getUserBrowseHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { error, value } = activityListSchema.validate(req.query);
    if (error) return res.status(400).json({ message: '分页参数无效' });
    const { page, limit } = value;

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
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '获取浏览历史失败');
    res.status(500).json({ message: '获取浏览历史失败' });
  }
};

// 清除用户浏览历史
export const clearBrowseHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const success = await BrowseHistoryModel.clearUserHistory(userId);

    res.json({ 
      message: success ? '清除成功' : '暂无浏览历史',
      cleared: success 
    });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '清除浏览历史失败');
    res.status(500).json({ message: '清除浏览历史失败' });
  }
};

// 删除单条浏览记录
export const deleteBrowseRecord = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = activityPathId(req.params.product_id);
    const success = await BrowseHistoryModel.deleteRecord(userId, productId);

    if (!success) {
      return res.status(404).json({ message: '浏览记录不存在' });
    }

    res.json({ message: '删除成功' });
  } catch (error) {
    if (error instanceof CustomerActivityError) return res.status(error.statusCode).json({ message: error.message });
    logger.error({ err: error }, '删除浏览记录失败');
    res.status(500).json({ message: '删除浏览记录失败' });
  }
};
