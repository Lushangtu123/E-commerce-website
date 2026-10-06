import { Request } from 'express';
import { logAdminAction } from './admin-log.controller';
import logger from '../utils/logger';
import { getRedisClient } from '../database/redis';

/** After a product or SKU write: drop the cached copies and record the action. Neither failure undoes the write. */
export async function afterProductWrite(req: Request, productIds: number[], action: string, resourceType: string, resourceId: string, description: string) {
  try {
    await getRedisClient().del(...productIds.map(id => `product:${id}`), 'products:hot');
  } catch (error) {
    logger.warn({ err: error }, '商品已写入，缓存清理失败');
  }
  try {
    await logAdminAction((req as any).admin.adminId, action, resourceType, resourceId, description, req.ip, req.get('user-agent'));
  } catch (error) {
    logger.warn({ err: error }, '商品已写入，操作日志记录失败');
  }
}
