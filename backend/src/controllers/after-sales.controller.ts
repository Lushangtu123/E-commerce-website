import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AfterSalesError, validAfterSalesId, getAfterSales, createAfterSales, withdrawAfterSales, reviewAfterSales, listAfterSales } from '../services/after-sales.service';
import logger from '../utils/logger';

function pathId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !validAfterSalesId(Number(value))) {
    throw new AfterSalesError('售后查询参数无效');
  }
  return Number(value);
}
function userId(req: AuthRequest): number {
  if (!validAfterSalesId(req.userId)) throw new AfterSalesError('未登录，请先登录', 401);
  return req.userId;
}
function fail(res: Response, error: unknown, message: string) {
  if (error instanceof AfterSalesError) return res.status(error.statusCode).json({ error: error.message });
  // Request bodies contain customer reasons; log only failure context.
  logger.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, message);
  return res.status(500).json({ error: message });
}
export const getCustomerAfterSales = async (req: AuthRequest, res: Response) => {
  try { return res.json({ after_sales: await getAfterSales(userId(req), pathId(req.params.id)) }); }
  catch (error) { return fail(res, error, '获取售后申请失败'); }
};
export const createCustomerAfterSales = async (req: AuthRequest, res: Response) => {
  try {
    const after_sales = await createAfterSales(userId(req), pathId(req.params.id), req.body);
    return res.status(201).json({ message: '售后申请已提交，审核通过后仍需另行完成退货或退款处理', after_sales });
  } catch (error) { return fail(res, error, '提交售后申请失败'); }
};
export const withdrawCustomerAfterSales = async (req: AuthRequest, res: Response) => {
  try {
    const after_sales = await withdrawAfterSales(userId(req), pathId(req.params.id));
    return res.json({ message: '售后申请已撤回', after_sales });
  } catch (error) { return fail(res, error, '撤回售后申请失败'); }
};
export const getAdminAfterSales = async (req: Request, res: Response) => {
  try { return res.json(await listAfterSales(req.query)); }
  catch (error) { return fail(res, error, '获取售后列表失败'); }
};
export const reviewAdminAfterSales = async (req: Request, res: Response) => {
  try {
    if (!validAfterSalesId(req.admin?.adminId)) throw new AfterSalesError('未认证', 401);
    const after_sales = await reviewAfterSales(req.admin.adminId, pathId(req.params.id), req.body, { ip: req.ip, userAgent: req.get('user-agent') });
    return res.json({ message: '审核已完成，尚未执行退款或库存回补', after_sales });
  } catch (error) { return fail(res, error, '审核售后申请失败'); }
};
