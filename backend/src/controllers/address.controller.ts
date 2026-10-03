import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AddressError, AddressModel, normalizeAddress, validAddressId } from '../models/address.model';
import logger from '../utils/logger';

function pathId(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return validAddressId(id) ? id : undefined;
}

function failure(res: Response, error: unknown, message: string) {
  if (error instanceof AddressError) return res.status(error.statusCode).json({ error: error.message });
  logger.error({ err: error }, message);
  return res.status(500).json({ error: message });
}

export class AddressController {
  static async list(req: AuthRequest, res: Response) {
    try {
      if (!validAddressId(req.userId)) return res.status(401).json({ error: '未登录，请先登录' });
      return res.json({ addresses: await AddressModel.list(req.userId) });
    } catch (error) { return failure(res, error, '获取收货地址失败'); }
  }

  static async create(req: AuthRequest, res: Response) {
    try {
      if (!validAddressId(req.userId)) return res.status(401).json({ error: '未登录，请先登录' });
      const fields = normalizeAddress(req.body);
      const addressId = await AddressModel.create(req.userId, fields);
      return res.status(201).json({ message: '收货地址创建成功', address_id: addressId });
    } catch (error) { return failure(res, error, '创建收货地址失败'); }
  }

  static async update(req: AuthRequest, res: Response) {
    try {
      if (!validAddressId(req.userId)) return res.status(401).json({ error: '未登录，请先登录' });
      const addressId = pathId(req.params.id);
      if (!addressId) return res.status(400).json({ error: '地址ID无效' });
      const fields = normalizeAddress(req.body);
      await AddressModel.update(req.userId, addressId, fields);
      return res.json({ message: '收货地址更新成功' });
    } catch (error) { return failure(res, error, '更新收货地址失败'); }
  }

  static async remove(req: AuthRequest, res: Response) {
    try {
      if (!validAddressId(req.userId)) return res.status(401).json({ error: '未登录，请先登录' });
      const addressId = pathId(req.params.id);
      if (!addressId) return res.status(400).json({ error: '地址ID无效' });
      await AddressModel.remove(req.userId, addressId);
      return res.json({ message: '收货地址删除成功' });
    } catch (error) { return failure(res, error, '删除收货地址失败'); }
  }
}
