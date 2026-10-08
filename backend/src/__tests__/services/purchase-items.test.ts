import { MAX_QUANTITY, normalizePurchaseItems } from '../../services/purchase-items.service';

test('同商品跨规格数量超过 INT 上限时拒绝，包括重复规格行', () => {
  expect(() => normalizePurchaseItems([
    { product_id: 1, sku_id: 11, quantity: 1000000000 },
    { product_id: 1, sku_id: 12, quantity: 1000000000 },
    { product_id: 1, sku_id: 11, quantity: 147483648 },
  ])).toThrow('商品数量超出范围');
});

test('同商品总量恰好达到上限仍按规格合并并排序', () => {
  expect(normalizePurchaseItems([
    { product_id: 1, sku_id: 12, quantity: MAX_QUANTITY - 1000000000 },
    { product_id: 1, sku_id: 11, quantity: 500000000 },
    { product_id: 1, sku_id: 11, quantity: 500000000 },
  ])).toEqual([
    { product_id: 1, sku_id: 11, quantity: 1000000000 },
    { product_id: 1, sku_id: 12, quantity: MAX_QUANTITY - 1000000000 },
  ]);
});

test('不同商品分别允许达到数量上限', () => {
  expect(normalizePurchaseItems([
    { product_id: 2, quantity: MAX_QUANTITY },
    { product_id: 1, sku_id: 11, quantity: MAX_QUANTITY },
  ])).toEqual([
    { product_id: 1, sku_id: 11, quantity: MAX_QUANTITY },
    { product_id: 2, quantity: MAX_QUANTITY },
  ]);
});
