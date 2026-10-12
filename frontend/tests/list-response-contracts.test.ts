import { describe, expect, it } from 'vitest';
import { readCatalogList } from '@/lib/catalog-list-response';
import { readAdminOrders, readAdminProducts, readAdminUsers } from '@/lib/admin-list-response';

const card = { product_id: 1, title: '商品', title_en: 'Product', price: '10.00', stock: '5', sales_count: 0, rating: '0.00' };
const catalog = () => ({ products: [card], page: 2, limit: 20, total: 21, totalPages: 2 });
const pagination = { page: 2, limit: 20, total: 21, totalPages: 2 };
const order = { order_id: 1, user_id: 4, order_no: 'ORDER-1', status: 1, total_amount: '10.00', created_at: '2026-10-12T00:00:00Z' };
const product = { ...card, stock: 5, status: 1, sellable_stock: 5, sku_min_price: '10.00' };
const user = { user_id: 1, username: 'Buyer', email: 'buyer@example.test', status: 1, created_at: order.created_at, total_spent: '10.00' };
const request = { page: 2, status: '1' };

describe('catalog list response', () => {
  it('keeps DECIMAL prices, translations and normalizes aggregate stock', () => {
    expect(readCatalogList(catalog(), 2).products[0]).toEqual({ ...card, stock: 5 });
  });
  it.each([null, {}, { ...catalog(), products: {} }, { ...catalog(), products: [null] },
    { ...catalog(), products: [card, card] }, { ...catalog(), products: [{ ...card, price: 'NaN' }] },
    { ...catalog(), products: [{ ...card, title: {} }] }, { ...catalog(), products: [{ ...card, stock: -1 }] },
    { ...catalog(), products: [{ ...card, status: 0 }] }, { ...catalog(), page: 1 }, { ...catalog(), limit: 10 },
    { ...catalog(), total: -1 }, { ...catalog(), total: '21' }, { ...catalog(), totalPages: 3 },
    { ...catalog(), success: false }, { ...catalog(), error: 'bad' }])('rejects malformed successful data %j', value => {
    expect(() => readCatalogList(value, 2)).toThrow();
  });
  it('accepts a true empty catalog and a shrinking out-of-range page', () => {
    expect(readCatalogList({ products: [], page: 1, limit: 20, total: 0, totalPages: 0 }, 1).products).toEqual([]);
    expect(readCatalogList({ products: [], page: 3, limit: 20, total: 1, totalPages: 1 }, 3).totalPages).toBe(1);
  });
  it('allows rows and COUNT to differ during concurrent writes', () => {
    expect(readCatalogList({ ...catalog(), total: 0, totalPages: 0 }, 2).products).toHaveLength(1);
  });
});

const readers = [
  { name: 'orders', read: readAdminOrders, key: 'orders', row: order },
  { name: 'products', read: readAdminProducts, key: 'products', row: product },
  { name: 'users', read: readAdminUsers, key: 'users', row: user },
];
describe.each(readers)('admin $name list response', ({ read, key, row }) => {
  const body = () => ({ [key]: [row], pagination });
  it('accepts a usable requested page', () => { expect(read(body(), request)).toEqual(body()); });
  it.each([null, {}, { pagination }, { [key]: {} , pagination }, { [key]: [null], pagination },
    { [key]: [row, row], pagination }, { [key]: [row], pagination: { ...pagination, page: 1 } },
    { [key]: [row], pagination: { ...pagination, limit: 10 } }, { [key]: [row], pagination: { ...pagination, totalPages: 3 } },
    { [key]: [row], pagination: { ...pagination, total: -1 } }, { [key]: [{ ...row, status: 0 }], pagination },
    { [key]: [row], pagination, error: 'bad' }, { [key]: [row], pagination, success: false }])('rejects invalid snapshots %j', value => {
    expect(() => read(value, request)).toThrow();
  });
  it('accepts empty pages and separate COUNT/SELECT races', () => {
    expect(read({ [key]: [], pagination: { ...pagination, total: 0, totalPages: 0 } }, request)).toBeDefined();
    expect(read({ [key]: [row], pagination: { ...pagination, total: 0, totalPages: 0 } }, request)).toBeDefined();
  });
});

it('rejects a different customer order when filtering by user', () => {
  expect(() => readAdminOrders({ orders: [order], pagination }, { ...request, userId: '5' })).toThrow();
});
it.each([
  { ...product, category_name: {} }, { ...product, sku_min_price: 'not money' },
  { ...product, sellable_stock: -1 }, { ...product, has_sku: 'yes' },
])('rejects unsafe inventory render fields %j', row => {
  expect(() => readAdminProducts({ products: [row], pagination }, request)).toThrow();
});

it('accepts customer lifetime spend exceeding one order DECIMAL ceiling', () => {
  const row = { ...user, total_spent: '199999999.98' };
  expect(readAdminUsers({ users: [row], pagination }, request).users[0].total_spent).toBe('199999999.98');
});
