import { Response } from 'express';
import { SearchHistoryModel } from '../models/search-history.model';
import { AuthRequest } from '../middleware/auth';

// 记录搜索历史
export const recordSearch = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { keyword, result_count } = req.body;

    if (!keyword) {
      return res.status(400).json({ message: '搜索关键词不能为空' });
    }

    const id = await SearchHistoryModel.add(
      keyword.trim(),
      userId,
      result_count || 0
    );

    res.json({ message: '记录成功', id });
  } catch (error) {
    console.error('记录搜索历史失败:', error);
    res.status(500).json({ message: '记录搜索历史失败' });
  }
};

// 获取用户搜索历史
export const getUserSearchHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 10;

    const history = await SearchHistoryModel.getUserHistory(userId, limit);

    res.json({ history });
  } catch (error) {
    console.error('获取搜索历史失败:', error);
    res.status(500).json({ message: '获取搜索历史失败' });
  }
};

// 获取热搜关键词
export const getHotKeywords = async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const limit = parseInt(req.query.limit as string) || 10;

    const keywords = await SearchHistoryModel.getHotKeywords(days, limit);

    res.json({ keywords });
  } catch (error) {
    console.error('获取热搜关键词失败:', error);
    res.status(500).json({ message: '获取热搜关键词失败' });
  }
};

// 清除用户搜索历史
export const clearSearchHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    const success = await SearchHistoryModel.clearUserHistory(userId);

    res.json({ 
      message: success ? '清除成功' : '暂无搜索历史',
      cleared: success 
    });
  } catch (error) {
    console.error('清除搜索历史失败:', error);
    res.status(500).json({ message: '清除搜索历史失败' });
  }
};

// 删除单条搜索记录
export const deleteSearchKeyword = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { keyword } = req.params;

    const success = await SearchHistoryModel.deleteKeyword(userId, keyword);

    if (!success) {
      return res.status(404).json({ message: '搜索记录不存在' });
    }

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除搜索记录失败:', error);
    res.status(500).json({ message: '删除搜索记录失败' });
  }
};

// 获取搜索建议
export const getSearchSuggestions = async (req: AuthRequest, res: Response) => {
  try {
    const { keyword } = req.query;
    const limit = parseInt(req.query.limit as string) || 5;

    if (!keyword || keyword.toString().trim().length === 0) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await SearchHistoryModel.getSuggestions(
      keyword.toString().trim(),
      limit
    );

    res.json({ suggestions });
  } catch (error) {
    console.error('获取搜索建议失败:', error);
    res.status(500).json({ message: '获取搜索建议失败' });
  }
};

