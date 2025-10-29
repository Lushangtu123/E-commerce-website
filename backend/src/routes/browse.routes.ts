import express from 'express';
import {
  recordBrowse,
  getUserBrowseHistory,
  clearBrowseHistory,
  deleteBrowseRecord
} from '../controllers/browse-history.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// 所有浏览历史路由都需要认证
router.use(authMiddleware);

// 记录浏览
router.post('/record', recordBrowse);

// 获取浏览历史
router.get('/history', getUserBrowseHistory);

// 清除浏览历史
router.delete('/history', clearBrowseHistory);

// 删除单条浏览记录
router.delete('/history/:product_id', deleteBrowseRecord);

export default router;

