import { describe, expect, it } from 'vitest';
import { customerOrderListSnapshot, customerOrderSnapshot, validCustomerOrder } from '@/lib/customer-order-recovery';

const order = { order_id: 1, order_no: 'ORDER-1', status: 0, total_amount: '50.00', created_at: '2026-10-08T00:00:00Z' };
const item = { item_id: 1, order_id: 1, product_id: 2, product_name: 'Shirt', price: '25.00', quantity: 2 };

describe('customer order read contract', () => {
  it.each([
    { page: 1, total: 0, orders: [order] },
    { page: 2, total: 11, orders: [order, { ...order, order_id: 2, order_no: 'ORDER-2' }] },
  ])('accepts rows inserted between COUNT and SELECT on page $page with earlier total $total', ({ page, total, orders }) => {
    const response = { orders, page, limit: 10, total, totalPages: Math.ceil(total / 10) };
    expect(customerOrderListSnapshot(response, { page, limit: 10 })).toEqual(response);
  });

  it.each([undefined, null, '', ' ', 'NaN', 'Infinity', Infinity, NaN, -1, '-1.00', {}, true, '0x10', '1e2', 0.001, Number.MIN_VALUE, 100000000, '10.001'])('rejects invalid required total %j', total_amount => {
    expect(validCustomerOrder({ ...order, total_amount })).toBe(false);
  });

  it.each([
    { order_no: undefined }, { order_no: {} }, { order_no: ' ' },
    { created_at: undefined }, { created_at: {} }, { created_at: 'invalid' },
    { original_amount: 'bad' }, { discount_amount: {} },
    { coupon_name: {} }, { coupon_code: [] }, { user_coupon_id: '1' },
    { payment_method: {} }, { shipping_company: {} }, { tracking_number: {} },
    { paid_at: {} }, { shipped_at: 'invalid' }, { completed_at: false },
    { shipping_address_snapshot: 'old address' },
    { shipping_address_snapshot: { receiver_name: {}, phone: '123' } },
    { shipping_address_snapshot: { receiver_name: 'Buyer', phone: '123', province: {}, city: null, district: null, detail_address: null } },
    { error: 'failed' }, { success: false },
  ])('rejects an order with malformed render fields %j', fields => {
    expect(validCustomerOrder({ ...order, ...fields })).toBe(false);
  });

  it.each([
    null, undefined, {}, [],
    { order, items: undefined }, { order }, { order, items: null },
    { order, items: [null] }, { order, items: [{}] },
    { order, items: [item], error: 'failed' }, { order, items: [item], success: false },
    { order: { ...order, order_id: 2 }, items: [item] },
  ])('rejects incomplete, error, or foreign detail envelopes %j', data => {
    expect(customerOrderSnapshot(data, 1)).toBeNull();
  });

  it.each([
    { order_id: 2 }, { item_id: 0 }, { product_id: null },
    { product_name: undefined }, { product_name: {} }, { product_name_en: {} }, { product_image: {} },
    { price: null }, { price: 'NaN' }, { price: -1 },
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: '2' }, { quantity: Infinity },
    { sku_id: '1' }, { sku_code: {} }, { sku_specs: [] }, { sku_specs: 'red' },
    { sku_specs: { color: {} } }, { sku_specs_en: [] },
    { sku_specs_en: { color: { name: 4 } } }, { sku_specs_en: { color: { value: {} } } },
    { sku_specs_en: { color: 'Color' } },
  ])('rejects malformed or foreign purchased items %j', fields => {
    expect(customerOrderSnapshot({ order, items: [{ ...item, ...fields }] }, 1)).toBeNull();
  });

  it('rejects duplicate purchased item identities', () => {
    expect(customerOrderSnapshot({ order, items: [item, item] }, 1)).toBeNull();
  });

  it.each([0, '0.00', 12.5, '12.50'])('keeps valid numeric and decimal money %j', total_amount => {
    expect(validCustomerOrder({ ...order, total_amount })).toBe(true);
  });

  it('keeps historical nullable fields, safe BIGINT identities, and real empty item arrays', () => {
    const legacy = { ...order, order_id: Number.MAX_SAFE_INTEGER, original_amount: null, discount_amount: null,
      shipping_address_snapshot: null, coupon_name: null, coupon_code: null, user_coupon_id: null,
      paid_at: null, shipped_at: null, completed_at: null, shipping_company: null, tracking_number: null };
    expect(customerOrderSnapshot({ order: legacy, items: [] }, legacy.order_id)).toEqual({ order: legacy, items: [] });
  });

  it('keeps bilingual SKU and address snapshots and optional legacy item fields', () => {
    const complete = { ...order, shipping_address_snapshot: { receiver_name: 'Buyer', phone: '123', province: null, city: null, district: null, detail_address: null } };
    const purchased = { ...item, product_name_en: 'Shirt', product_image: null, sku_id: null, sku_code: null,
      sku_specs: { color: 'red', size: 2, gift: false }, sku_specs_en: { color: { name: 'Color', value: 'Red' } } };
    expect(customerOrderSnapshot({ order: complete, items: [purchased] }, 1)).toEqual({ order: complete, items: [purchased] });
  });

  it.each([null, ''])('keeps historical nullable or empty product names %j', product_name => {
    expect(customerOrderSnapshot({ order, items: [{ ...item, product_name }] }, 1)).not.toBeNull();
  });
});
