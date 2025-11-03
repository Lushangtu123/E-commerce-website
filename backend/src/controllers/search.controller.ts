import { Response } from 'express';
import { SearchHistoryModel } from '../models/search-history.model';
import { AuthRequest } from '../middleware/auth';
import { searchProducts as esSearchProducts } from '../database/elasticsearch';

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

// Elasticsearch 高级搜索
export const elasticsearchSearch = async (req: AuthRequest, res: Response) => {
  try {
    const {
      keyword = '',
      category_id,
      min_price,
      max_price,
      brand,
      sort_by = 'sales',
      sort_order = 'desc',
      page = 1,
      page_size = 20,
    } = req.query;

    // 参数转换
    const searchParams = {
      keyword: keyword.toString().trim(),
      category_id: category_id ? parseInt(category_id.toString()) : undefined,
      min_price: min_price ? parseFloat(min_price.toString()) : undefined,
      max_price: max_price ? parseFloat(max_price.toString()) : undefined,
      brand: brand?.toString(),
      sort_by: sort_by as 'price' | 'sales' | 'created_at',
      sort_order: sort_order as 'asc' | 'desc',
      page: parseInt(page.toString()),
      page_size: parseInt(page_size.toString()),
    };

    // 执行搜索
    const result = await esSearchProducts(searchParams);

    // 记录搜索历史
    if (searchParams.keyword && result.total > 0) {
      const userId = req.user?.userId;
      await SearchHistoryModel.add(searchParams.keyword, userId, result.total);
    }

    res.json({
      success: true,
      data: result.products,
      pagination: {
        page: result.page,
        page_size: result.page_size,
        total: result.total,
        total_pages: result.total_pages,
      },
    });
  } catch (error) {
    console.error('Elasticsearch 搜索失败:', error);
    res.status(500).json({ 
      success: false,
      message: 'Elasticsearch 搜索失败，请稍后重试' 
    });
  }
};

