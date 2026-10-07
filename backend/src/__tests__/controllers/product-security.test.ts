import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import productRoutes from '../../routes/product.routes';
import cartRoutes from '../../routes/cart.routes';
import { ProductModel } from '../../models/product.model';
import { query, getPool } from '../../database/mysql';
import { createProduct, updateProduct } from '../../controllers/admin-product.controller';

jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({ del: jest.fn().mockResolvedValue(1) }) }));

const app = express();
app.use(express.json());
app.use('/products', productRoutes);
app.use('/cart', cartRoutes);
// Controller input contract; production admin routes provide the authentication middleware.
app.post('/admin-products', createProduct);
app.put('/admin-products/:productId', updateProduct);
const adminToken = jwt.sign({ adminId: 1, type: 'admin' }, 'test-jwt-secret');
const userToken = jwt.sign({ userId: 1 }, 'test-jwt-secret');
const sql = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (getPool as jest.Mock).mockReturnValue({ query: sql });
  sql.mockImplementation(async (statement: string) => {
    if (statement.includes('FROM admins')) return [[{ admin_id: 1, username: 'editor', role_id: 2, status: 1 }]];
    if (statement.includes('FROM role_permissions')) return [[{ permission_code: 'product:create' }, { permission_code: 'product:edit' }]];
    return [[{ role_name: 'editor' }]];
  });
  (query as jest.Mock).mockImplementation(async (statement: string) => {
    if (statement.startsWith('SELECT auth_version')) return [{ auth_version: 0, status: 1 }];
    if (statement.includes('COUNT(*)')) return [{ total: 0 }];
    if (statement.startsWith('SELECT')) return [];
    return { insertId: 9, affectedRows: 1 };
  });
});

test('匿名请求不能写商品，且不连接数据库', async () => {
  await request(app).post('/products').send({ title: '商品', price: 5 }).expect(401);
  await request(app).put('/products/1').send({ price: 5 }).expect(401);
  expect(getPool).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

test('普通用户不能写商品，授权管理员可以创建商品', async () => {
  await request(app).post('/products').set('Authorization', `Bearer ${userToken}`).send({ title: '商品', price: 5 }).expect(403);
  const response = await request(app).post('/products').set('Authorization', `Bearer ${adminToken}`).send({ title: '商品', price: 5, stock: 2 }).expect(201);
  expect(response.body.product_id).toBe(9);
});

test('缺少商品编辑权限的管理员不能修改商品', async () => {
  sql.mockImplementation(async (statement: string) => {
    if (statement.includes('FROM admins')) return [[{ admin_id: 1, role_id: 2, status: 1 }]];
    if (statement.includes('FROM role_permissions')) return [[]];
    return [[{ role_name: 'viewer' }]];
  });
  await request(app).put('/products/1').set('Authorization', `Bearer ${adminToken}`).send({ price: 5 }).expect(403);
  expect(query).not.toHaveBeenCalled();
});

test('商品列表保持公开并支持已有价格排序', async () => {
  await request(app).get('/products').query({ sort: 'price ASC', page: 2, limit: 10 }).expect(200);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ORDER BY price ASC'), [10, 10]);
});

test.each([
  { sort: 'price; DROP TABLE products' }, { page: '-1' }, { page: '1x' },
  { limit: '10001' }, { min_price: 'NaN' }, { min_price: '5', max_price: '1' }
])('商品查询拒绝非法参数 %j', async params => {
  await request(app).get('/products').query(params).expect(400);
  expect(query).not.toHaveBeenCalled();
});

test('模型也拒绝任意排序片段及更新列名', async () => {
  await expect(ProductModel.list({ sort: 'price; SELECT SLEEP(3)' })).rejects.toThrow();
  await expect(ProductModel.update(1, { 'stock = 999 --': 1 } as any)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});

test.each([{ price: -1 }, { stock: -2 }, { stock: 1.5 }, { product_id: 9 }, {}])('商品更新拒绝非法字段或值 %j', async body => {
  await request(app).put('/products/1').set('Authorization', `Bearer ${adminToken}`).send(body).expect(400);
  expect(query).not.toHaveBeenCalled();
});

test.each([-1, 0, 1.5, '2', null])('购物车添加拒绝非法数量 %j', async quantity => {
  await request(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ product_id: 1, quantity }).expect(400);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith('SELECT auth_version, status FROM users WHERE user_id = ?', [1]);
});

test('购物车保留数量为零时删除及正常添加', async () => {
  const connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (statement: string) => {
      if (statement.includes('FROM products')) return [[{ product_id: 1, title: '商品', price: '5.00', stock: 10, status: 1 }], []];
      if (statement.includes('SELECT')) return [[], []];
      return [{ affectedRows: 1 }, []];
    }),
  };
  (getPool as jest.Mock).mockReturnValue({ getConnection: async () => connection });
  await request(app).post('/cart').set('Authorization', `Bearer ${userToken}`).send({ product_id: 1, quantity: 2 }).expect(200);
  await request(app).put('/cart').set('Authorization', `Bearer ${userToken}`).send({ product_id: 1, quantity: 0 }).expect(200);
  expect(query).toHaveBeenLastCalledWith('DELETE FROM cart WHERE user_id = ? AND product_id = ? AND sku_key = ?', [1, 1, 0]);
});

test.each([{ price: -1 }, { stock: -2 }, { stock: 1.5 }, { price: '5' }])('后台商品创建也拒绝非法输入 %j', async fields => {
  await request(app).post('/admin-products').send({ title: '商品', price: 5, stock: 1, category_id: 1, ...fields }).expect(400);
  expect(sql).not.toHaveBeenCalled();
});

test('后台商品更新在查询前拒绝负数库存', async () => {
  await request(app).put('/admin-products/1').send({ stock: -1 }).expect(400);
  expect(sql).not.toHaveBeenCalled();
});
