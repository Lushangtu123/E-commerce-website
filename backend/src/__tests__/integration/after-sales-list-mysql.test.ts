import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { migrateFulfillment } from '../../database/migrate-fulfillment';
import { listAfterSales, getAfterSalesById } from '../../services/after-sales.service';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('after-sales admin list context in real MySQL', () => {
  const database = `after_sales_list_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 4 };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'orders'].includes(match[2])) await db.query(match[1]);
    }
    await migrateFulfillment(db);
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(7,'Known customer','private@test','secret')");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status,payment_method) VALUES(10,'ORDER-10',7,29.99,3,'external'),(11,'ORDER-11',8,5.00,3,'demo')");
    await db.query("INSERT INTO after_sales_requests(request_id,order_id,user_id,type,reason,status) VALUES(1,10,7,'refund','Damaged','approved'),(2,11,8,'return','Changed mind','approved')");
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  test('actual list SQL returns customer and paid context while retaining a missing customer', async () => {
    const data = await listAfterSales({ status: 'approved' });
    expect(data.pagination.total).toBe(2); expect(data.requests).toHaveLength(2);
    expect(data.requests.find(value => value.request_id === 1)).toMatchObject({ user_id: 7, username: 'Known customer', order_no: 'ORDER-10', total_amount: '29.99', payment_method: 'external' });
    expect(data.requests.find(value => value.request_id === 2)).toMatchObject({ user_id: 8, username: null, order_no: 'ORDER-11', total_amount: '5.00', payment_method: 'demo' });
    for (const value of data.requests) {
      expect(value).not.toHaveProperty('email'); expect(value).not.toHaveProperty('password_hash'); expect(value).not.toHaveProperty('phone');
    }
  });
  test('exact request SQL returns paid context independently of page and status', async () => {
    expect(await getAfterSalesById(1)).toMatchObject({ request_id: 1, user_id: 7, username: 'Known customer', order_no: 'ORDER-10', total_amount: '29.99', payment_method: 'external', status: 'approved' });
    const missingCustomer = await getAfterSalesById(2);
    expect(missingCustomer).toMatchObject({ request_id: 2, username: null, payment_method: 'demo' });
    for (const field of ['email', 'password_hash', 'phone']) expect(missingCustomer).not.toHaveProperty(field);
    await expect(getAfterSalesById(999)).rejects.toMatchObject({ statusCode: 404 });
  });
});
