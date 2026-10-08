import { Request, Response } from 'express';
import { SKUError, SKUModel } from '../models/sku.model';
import logger from '../utils/logger';
import { ProductModel } from '../models/product.model';
import { positiveId } from '../utils/product-validation';
import { skuCreateSchema, skuUpdateSchema, skuBatchSchema } from '../utils/sku-validation';
import { afterProductWrite } from './admin-product-write';

function skuFailure(res: Response, error: unknown, message: string) {
  if (error instanceof SKUError) return res.status(error.statusCode).json({ error: error.message });
  logger.error({ err: error }, message);
  return res.status(500).json({ error: message });
}

// 获取商品的所有SKU
export const getProductSKUs = async (req: Request, res: Response) => {
  try {
    const productId = positiveId(req.params.productId);
    if (!productId) return res.status(400).json({ error: '商品ID无效' });
    const product = await ProductModel.findById(productId);
    if (!product || product.status === -1) return res.status(404).json({ error: '商品不存在' });
    const skus = await SKUModel.findByProductId(productId, true);
    res.json({ product: { product_id: product.product_id, title: product.title, title_en: product.title_en ?? null, status: product.status }, skus });
  } catch (error) {
    skuFailure(res, error, '获取SKU列表失败');
  }
};

// 创建SKU
export const createSKU = async (req: Request, res: Response) => {
  try {
    const productId = positiveId(req.params.productId);
    const { error, value } = skuCreateSchema.validate(req.body);
    if (!productId || error) return res.status(400).json({ error: '商品ID、SKU字段或值无效' });
    const skuId = await SKUModel.create({ ...value, product_id: productId });
    await afterProductWrite(req, [productId], 'CREATE_SKU', 'sku', String(skuId), `为商品${productId}创建SKU: ${value.sku_code}`);

    res.status(201).json({
      message: 'SKU创建成功',
      sku_id: skuId
    });
  } catch (error) {
    skuFailure(res, error, '创建SKU失败');
  }
};

// 批量创建SKU
export const batchCreateSKUs = async (req: Request, res: Response) => {
  try {
    const productId = positiveId(req.params.productId);
    const { error, value } = skuBatchSchema.validate(req.body);
    if (!productId || error) return res.status(400).json({ error: '商品ID或SKU列表无效' });
    const { skus } = value;
    await SKUModel.createBatch(skus.map((sku: any) => ({ ...sku, product_id: productId })));
    await afterProductWrite(req, [productId], 'BATCH_CREATE_SKU', 'sku', String(productId), `为商品${productId}批量创建${skus.length}个SKU`);

    res.status(201).json({
      message: `成功创建${skus.length}个SKU`,
      count: skus.length
    });
  } catch (error) {
    skuFailure(res, error, '批量创建SKU失败');
  }
};

// 更新SKU
export const updateSKU = async (req: Request, res: Response) => {
  try {
    const skuId = positiveId(req.params.skuId);
    const productId = req.params.productId === undefined ? undefined : positiveId(req.params.productId);
    const { error, value } = skuUpdateSchema.validate(req.body);
    if (!skuId || error || (req.params.productId !== undefined && !productId)) return res.status(400).json({ error: '商品或SKU ID、字段或值无效' });
    const sku = await SKUModel.findById(skuId);
    if (!sku || (productId !== undefined && sku.product_id !== productId)) return res.status(404).json({ error: 'SKU不存在' });
    const success = await SKUModel.update(skuId, value, productId);
    if (!success) return res.status(404).json({ error: 'SKU不存在' });
    await afterProductWrite(req, [sku.product_id], 'UPDATE_SKU', 'sku', String(skuId), '更新SKU');

    res.json({ message: '更新成功' });
  } catch (error) {
    skuFailure(res, error, '更新SKU失败');
  }
};

// 删除SKU
export const deleteSKU = async (req: Request, res: Response) => {
  try {
    const skuId = positiveId(req.params.skuId);
    const productId = req.params.productId === undefined ? undefined : positiveId(req.params.productId);
    if (!skuId || (req.params.productId !== undefined && !productId)) return res.status(400).json({ error: '商品或SKU ID无效' });
    const sku = await SKUModel.findById(skuId);
    if (!sku || (productId !== undefined && sku.product_id !== productId)) return res.status(404).json({ error: 'SKU不存在' });
    const success = await SKUModel.delete(skuId, productId);
    if (!success) return res.status(404).json({ error: 'SKU不存在' });
    await afterProductWrite(req, [sku.product_id], 'DELETE_SKU', 'sku', String(skuId), '删除SKU');

    res.json({ message: '删除成功' });
  } catch (error) {
    skuFailure(res, error, '删除SKU失败');
  }
};
