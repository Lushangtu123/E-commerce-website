import { Response } from 'express';
import { SearchHistoryModel } from '../models/search-history.model';
import { AuthRequest } from '../middleware/auth';
import Joi from 'joi';
import { searchProducts } from '../services/product-search.service';
import logger from '../utils/logger';
import { hotSearchSchema, searchHistorySchema, searchKeyword, searchRecordSchema, searchSuggestionsSchema } from '../utils/search-validation';

// 记录搜索历史
export const recordSearch = async (req: AuthRequest, res: Response) => {
  const { error, value } = searchRecordSchema.validate(req.body);
  if (error) return res.status(400).json({ message: '搜索参数无效' });
  try {
    const userId = req.user?.userId;
    const id = await SearchHistoryModel.add(value.keyword, userId, value.result_count);

    res.json({ message: '记录成功', id });
  } catch (error) {
    logger.error({ err: error }, '记录搜索历史失败');
    res.status(500).json({ message: '记录搜索历史失败' });
  }
};

// 获取用户搜索历史
export const getUserSearchHistory = async (req: AuthRequest, res: Response) => {
  const { error, value } = searchHistorySchema.validate(req.query);
  if (error) return res.status(400).json({ message: '搜索参数无效' });
  try {
    const userId = req.user?.userId;
    const history = await SearchHistoryModel.getUserHistory(userId, value.limit);

    res.json({ history });
  } catch (error) {
    logger.error({ err: error }, '获取搜索历史失败');
    res.status(500).json({ message: '获取搜索历史失败' });
  }
};

// 获取热搜关键词
export const getHotKeywords = async (req: AuthRequest, res: Response) => {
  const { error, value } = hotSearchSchema.validate(req.query);
  if (error) return res.status(400).json({ message: '搜索参数无效' });
  try {
    const keywords = await SearchHistoryModel.getHotKeywords(value.days, value.limit);

    res.json({ keywords });
  } catch (error) {
    logger.error({ err: error }, '获取热搜关键词失败');
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
    logger.error({ err: error }, '清除搜索历史失败');
    res.status(500).json({ message: '清除搜索历史失败' });
  }
};

// 删除单条搜索记录
export const deleteSearchKeyword = async (req: AuthRequest, res: Response) => {
  const { error, value: keyword } = searchKeyword.min(1).required().validate(req.params.keyword);
  if (error) return res.status(400).json({ message: '搜索参数无效' });
  try {
    const userId = req.user?.userId;
    const success = await SearchHistoryModel.deleteKeyword(userId, keyword);

    if (!success) {
      return res.status(404).json({ message: '搜索记录不存在' });
    }

    res.json({ message: '删除成功' });
  } catch (error) {
    logger.error({ err: error }, '删除搜索记录失败');
    res.status(500).json({ message: '删除搜索记录失败' });
  }
};

// 获取搜索建议
export const getSearchSuggestions = async (req: AuthRequest, res: Response) => {
  const { error, value } = searchSuggestionsSchema.validate(req.query);
  if (error) return res.status(400).json({ message: '搜索参数无效' });
  try {
    if (!value.keyword) {
      return res.json({ suggestions: [] });
    }
    const suggestions = await SearchHistoryModel.getSuggestions(value.keyword, value.limit);

    res.json({ suggestions });
  } catch (error) {
    logger.error({ err: error }, '获取搜索建议失败');
    res.status(500).json({ message: '获取搜索建议失败' });
  }
};

// Elasticsearch 只能分页到前 10000 条结果
const MAX_RESULT_WINDOW = 10000;
const productSearchSchema = Joi.object({
  keyword: searchKeyword.allow('').default(''),
  category_id: Joi.number().integer().min(1).max(2147483647),
  min_price: Joi.number().min(0).max(99999999.99),
  max_price: Joi.number().max(99999999.99).min(Joi.ref('min_price', { adjust: value => value ?? 0 })),
  brand: Joi.string().trim().min(1).max(100),
  sort_by: Joi.string().valid('price', 'sales', 'created_at').default('sales'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  page_size: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false).custom((value, helpers) =>
  value.page * value.page_size > MAX_RESULT_WINDOW ? helpers.error('any.invalid') : value);

// 商品搜索：优先 Elasticsearch，未配置或不可用时回退到 MySQL
export const elasticsearchSearch = async (req: AuthRequest, res: Response) => {
  const { error, value: params } = productSearchSchema.validate(req.query);
  if (error) return res.status(400).json({ success: false, message: '搜索参数无效' });
  try {
    const { products, total, engine } = await searchProducts(params);

    if (params.keyword && total > 0) {
      try {
        await SearchHistoryModel.add(params.keyword, req.userId, total);
      } catch (historyError) {
        logger.warn({ err: historyError }, '搜索历史记录失败');
      }
    }

    res.json({
      success: true,
      engine,
      data: products,
      pagination: {
        page: params.page,
        page_size: params.page_size,
        total,
        total_pages: Math.ceil(total / params.page_size),
      },
    });
  } catch (searchError) {
    logger.error({ err: searchError }, '商品搜索失败');
    res.status(500).json({ success: false, message: '商品搜索失败，请稍后重试' });
  }
};
