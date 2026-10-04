import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { migrateReviewTables } from '../../database/migrate-review';
import { getPool, query } from '../../database/mysql';
import { ReviewModel } from '../../models/review.model';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import reviewRoutes from '../../routes/review.routes';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;

integration('真实 MySQL 评价完整性与迁移', () => {
  const database = `ecom_review_integrity_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } :
      { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    connectionLimit: 8, timezone: '+00:00',
  };
  let server: Pool;
  let db: Pool;
  let created = false;
  const schemas = new Map<string, string>();
  const app = express();
  app.use(express.json());
  app.use('/api/reviews', reviewRoutes);
  const auth = (userId: number) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) schemas.set(match[2], match[1]);
    await db.query(schemas.get('orders')!);
    await db.query(schemas.get('order_items')!);
    await db.query(schemas.get('users')!);
    await db.query(schemas.get('products')!);
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'buyer','buyer@example.test','private'),(2,'other','other@example.test','private')");
    await db.query("INSERT INTO products (product_id,title,price) VALUES (1,'原始商品名',10),(2,'另一商品',10)");
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (created) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    await db.query('DROP TABLE IF EXISTS reviews');
    await db.query(schemas.get('reviews')!);
    await db.query('DELETE FROM order_items');
    await db.query('DELETE FROM orders');
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status) VALUES (1,'REVIEW-ORDER',1,20,3)");
    await db.query('INSERT INTO order_items (order_id,product_id,quantity,price) VALUES (1,1,1,10),(1,2,1,10)');
  });

  const insert = (userId = 1, rating = 4) => db.query(
    'INSERT INTO reviews (product_id,user_id,order_id,rating,content) VALUES (1,?,1,?,?)',
    [userId, rating, '保留原始评价'],
  );

  test('新建评价表拒绝同订单同商品重复，包括不同 user_id 的重复', async () => {
    await insert();
    await expect(insert(2)).rejects.toMatchObject({ errno: 1062 });
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM reviews');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('保留原始评价');
  });

  test('旧评价表升级保留所有字段且可重复运行，升级后阻止重复和非法评分', async () => {
    await db.query('ALTER TABLE reviews DROP INDEX uk_review_order_product, DROP CHECK ck_reviews_rating');
    await insert();
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM reviews');
    await migrateReviewTables(db);
    await migrateReviewTables(db);
    await expect(insert(2)).rejects.toMatchObject({ errno: 1062 });
    await expect(db.query('UPDATE reviews SET rating = 6')).rejects.toThrow();
    const [after] = await db.query<RowDataPacket[]>('SELECT * FROM reviews');
    expect(after).toEqual(before);
  });

  test.each(['新表', '尚未升级的旧表'])('%s 并发评价只成功一次，仍允许同订单其他商品评价', async schema => {
    if (schema === '尚未升级的旧表') await db.query('ALTER TABLE reviews DROP INDEX uk_review_order_product, DROP CHECK ck_reviews_rating');
    const results = await Promise.allSettled([
      ReviewModel.create(1, 1, 1, 4, '第一次评价'),
      ReviewModel.create(1, 1, 1, 5, '并发评价'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM reviews');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(1);
    await expect(ReviewModel.create(2, 1, 1, 3)).resolves.toBeGreaterThan(0);
  });

  test('拒绝他人订单、非订单商品和未完成订单，合法提交仍可成功', async () => {
    await expect(ReviewModel.create(1, 2, 1, 5)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ReviewModel.create(3, 1, 1, 5)).rejects.toMatchObject({ statusCode: 400 });
    await expect(ReviewModel.create(1, 1, 99, 5)).rejects.toMatchObject({ statusCode: 404 });
    for (const status of [0, 1, 2, 4]) {
      await db.query('UPDATE orders SET status = ?', [status]);
      await expect(ReviewModel.create(1, 1, 1, 5)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect((await db.query<RowDataPacket[]>('SELECT * FROM reviews'))[0]).toHaveLength(0);
    await db.query('UPDATE orders SET status = 3');
    await expect(ReviewModel.create(1, 1, 1, 5, '有效评价', ['https://example.test/photo.jpg'])).resolves.toBeGreaterThan(0);
  });

  test('插入失败释放订单锁，后续评价可以成功', async () => {
    await db.query("CREATE TRIGGER test_review_failure BEFORE INSERT ON reviews FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'review insert failure'");
    try {
      await expect(ReviewModel.create(1, 1, 1, 5)).rejects.toThrow('review insert failure');
      expect((await db.query<RowDataPacket[]>('SELECT * FROM reviews'))[0]).toHaveLength(0);
    } finally { await db.query('DROP TRIGGER test_review_failure'); }
    await expect(ReviewModel.create(1, 1, 1, 5)).resolves.toBeGreaterThan(0);
  });

  test.each(['重复评价', '非法评分'])('旧库存在%s 时停止迁移，数据和表结构不变', async conflict => {
    await db.query('ALTER TABLE reviews DROP INDEX uk_review_order_product, DROP CHECK ck_reviews_rating');
    await insert();
    if (conflict === '重复评价') await insert(2);
    else await db.query('UPDATE reviews SET rating = 6');
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM reviews ORDER BY review_id');
    const [schemaBefore] = await db.query<RowDataPacket[]>('SHOW CREATE TABLE reviews');
    await expect(migrateReviewTables(db)).rejects.toThrow(conflict);
    expect((await db.query<RowDataPacket[]>('SELECT * FROM reviews ORDER BY review_id'))[0]).toEqual(before);
    expect((await db.query<RowDataPacket[]>('SHOW CREATE TABLE reviews'))[0]).toEqual(schemaBefore);
    // A failed migration releases its advisory lock and can be retried after manual repair.
    if (conflict === '重复评价') await db.query('DELETE FROM reviews WHERE user_id = 2');
    else await db.query('UPDATE reviews SET rating = 4');
    await migrateReviewTables(db);
    await expect(insert(2)).rejects.toMatchObject({ errno: 1062 });
  });

  test.each(['错误索引', '未启用评分约束', '错误评分范围'])('同名%s 不自动覆盖，原表保持不变', async conflict => {
    if (conflict === '错误索引') await db.query('ALTER TABLE reviews DROP INDEX uk_review_order_product, ADD INDEX uk_review_order_product (order_id, product_id)');
    else if (conflict === '未启用评分约束') await db.query('ALTER TABLE reviews ALTER CHECK ck_reviews_rating NOT ENFORCED');
    else await db.query('ALTER TABLE reviews DROP CHECK ck_reviews_rating, ADD CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 10)');
    const [before] = await db.query<RowDataPacket[]>('SHOW CREATE TABLE reviews');
    await expect(migrateReviewTables(db)).rejects.toThrow('定义不一致');
    expect((await db.query<RowDataPacket[]>('SHOW CREATE TABLE reviews'))[0]).toEqual(before);
  });

  test('并发运行旧库迁移可以重复完成且保留历史记录', async () => {
    await db.query('ALTER TABLE reviews DROP INDEX uk_review_order_product, DROP CHECK ck_reviews_rating');
    await insert();
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM reviews');
    await Promise.all([migrateReviewTables(db), migrateReviewTables(db)]);
    expect((await db.query<RowDataPacket[]>('SELECT * FROM reviews'))[0]).toEqual(before);
    await expect(insert(2)).rejects.toMatchObject({ errno: 1062 });
  });

  test('真实HTTP创建返回201和并发409，公开列表与本人列表保留分页和隔离', async () => {
    const body = { product_id: 1, order_id: 1, rating: 5, content: '我的原始评价' };
    const results = await Promise.all([
      request(app).post('/api/reviews').set('Authorization', auth(1)).send(body),
      request(app).post('/api/reviews').set('Authorization', auth(1)).send(body),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(results.find(result => result.status === 409)?.body).toEqual({ error: '评论已存在，请勿重复提交' });
    await db.query("INSERT INTO reviews (product_id,user_id,order_id,rating,content) VALUES (1,2,2,4,'其他用户评价')");
    await db.query("UPDATE reviews SET created_at = '2026-01-01 12:00:00'");
    const publicList = await request(app).get('/api/reviews/product/1?page=2&limit=1');
    expect(publicList.status).toBe(200);
    expect(publicList.body).toMatchObject({ total: 2, page: 2, limit: 1, totalPages: 2, reviews: [{ content: '我的原始评价', username: 'buyer' }] });
    const mine = await request(app).get('/api/reviews/my').set('Authorization', auth(1));
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ total: 1, page: 1, limit: 10, reviews: [{ user_id: 1, product_title: '原始商品名' }] });
    expect((await request(app).get('/api/reviews/my?user_id=2').set('Authorization', auth(1))).status).toBe(400);
  });

  test('真实HTTP拒绝匿名创建、他人订单和伪造商品，失败后没有评价写入', async () => {
    const body = { product_id: 1, order_id: 1, rating: 5 };
    expect((await request(app).post('/api/reviews').send(body)).status).toBe(401);
    expect((await request(app).post('/api/reviews').set('Authorization', auth(2)).send(body)).status).toBe(403);
    expect((await request(app).post('/api/reviews').set('Authorization', auth(1)).send({ ...body, product_id: 99 })).status).toBe(400);
    expect((await request(app).post('/api/reviews').set('Authorization', auth(1)).send({ ...body, user_id: 2 })).status).toBe(400);
    expect((await db.query<RowDataPacket[]>('SELECT * FROM reviews'))[0]).toHaveLength(0);
  });

  test('真实HTTP按订单过滤本人评价，分页不会返回其他订单或其他买家的记录', async () => {
    await ReviewModel.create(1, 1, 1, 4, '订单一商品一');
    await ReviewModel.create(2, 1, 1, 5, '订单一商品二');
    await db.query("INSERT INTO reviews (product_id,user_id,order_id,rating,content) VALUES (1,1,2,3,'本人其他订单'),(1,2,3,2,'其他买家订单')");
    for (const page of [1, 2]) {
      const res = await request(app).get(`/api/reviews/my?order_id=1&page=${page}&limit=1`).set('Authorization', auth(1));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 2, totalPages: 2, page, limit: 1 });
      expect(res.body.reviews).toHaveLength(1);
      expect(res.body.reviews[0]).toMatchObject({ user_id: 1, order_id: 1, content: page === 1 ? '订单一商品二' : '订单一商品一' });
    }
    const foreign = await request(app).get('/api/reviews/my?order_id=3').set('Authorization', auth(1));
    expect(foreign.status).toBe(200); expect(foreign.body.reviews).toEqual([]); expect(foreign.body.total).toBe(0);
    expect((await request(app).get('/api/reviews/my?order_id=1')).status).toBe(401);
    expect((await request(app).get('/api/reviews/my?order_id=1%20OR%201=1').set('Authorization', auth(1))).status).toBe(400);
    const all = await request(app).get('/api/reviews/my').set('Authorization', auth(1));
    expect(all.body.total).toBe(3);
  });
});
