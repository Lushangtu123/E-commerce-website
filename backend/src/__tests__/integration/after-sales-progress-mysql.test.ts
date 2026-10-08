import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { migrateFulfillment } from '../../database/migrate-fulfillment';
import { createAfterSales, getAfterSales, reviewAfterSales } from '../../services/after-sales.service';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const service = () => require('../../services/after-sales.service');
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('after-sales return and manual closure in real MySQL', () => {
  const database = `after_sales_progress_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 8 };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    for (const file of ['migrate.ts', 'admin-migrate.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '../../database', file), 'utf8');
      for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
        if (['orders', 'roles', 'admins', 'admin_logs'].includes(match[2])) await db.query(match[1]);
      }
    }
    await migrateFulfillment(db);
    const migration = path.join(__dirname, '../../database/migrate-after-sales-progress.ts');
    if (fs.existsSync(migration)) {
      const { migrateAfterSalesProgress } = require(migration);
      await migrateAfterSalesProgress(db); await migrateAfterSalesProgress(db);
    }
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    (getPool as jest.Mock).mockReturnValue(db);
    for (const table of ['after_sales_requests', 'admin_logs', 'admins', 'roles', 'orders']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO roles(role_id,role_name) VALUES(1,'operator')");
    await db.query("INSERT INTO admins(admin_id,username,password_hash,role_id) VALUES(2,'operator','test',1)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status,payment_method) VALUES(10,'order10',7,29.99,3,'external')");
  });
  const tracking = { company: ' Test carrier ', tracking_number: ' RETURN-123 ' };
  const closure = { refund_amount: '29.99', refund_reference: ' manual-ref-1 ', note: ' Returned and refunded ' };
  async function approved(type: 'return' | 'refund' = 'return') {
    const value = await createAfterSales(7, 10, { type, reason: 'private reason' });
    return reviewAfterSales(2, value.request_id, { status: 'approved', note: 'private approval' });
  }
  test('approved return records its parcel, manual refund and closure without changing order', async () => {
    const value = await approved();
    const shipped = await service().submitReturnTracking(7, 10, tracking);
    expect(shipped).toMatchObject({ return_company: 'Test carrier', return_tracking_number: 'RETURN-123', status: 'approved', completed_at: null });
    expect(shipped.return_submitted_at).toBeTruthy();
    const completed = await service().completeAfterSales(2, value.request_id, closure);
    expect(completed).toMatchObject({ refund_amount: '29.99', refund_reference: 'manual-ref-1', completion_note: 'Returned and refunded', completed_by: 2, status: 'approved' });
    expect(completed.completed_at).toBeTruthy();
    const [orders] = await db.query<RowDataPacket[]>('SELECT status,total_amount FROM orders WHERE order_id=10');
    expect(orders[0]).toMatchObject({ status: 3, total_amount: '29.99' });
    const [audit] = await db.query<RowDataPacket[]>("SELECT * FROM admin_logs WHERE action='COMPLETE_AFTER_SALES'");
    expect(audit).toHaveLength(1); expect(audit[0].description).not.toMatch(/private|manual-ref|Returned/);
  });
  test('tracking belongs to the customer and is accepted once only for an approved return', async () => {
    await createAfterSales(7, 10, { type: 'return', reason: 'test' });
    await expect(service().submitReturnTracking(7, 10, tracking)).rejects.toMatchObject({ statusCode: 409 });
    const current = await getAfterSales(7, 10);
    await reviewAfterSales(2, current!.request_id, { status: 'approved', note: 'test' });
    await expect(service().submitReturnTracking(8, 10, tracking)).rejects.toMatchObject({ statusCode: 404 });
    await service().submitReturnTracking(7, 10, tracking);
    await expect(service().submitReturnTracking(7, 10, tracking)).rejects.toMatchObject({ statusCode: 409 });
  });
  test('refund requests cannot submit return tracking and can close without a parcel', async () => {
    const value = await approved('refund');
    await expect(service().submitReturnTracking(7, 10, tracking)).rejects.toMatchObject({ statusCode: 409 });
    expect(await service().completeAfterSales(2, value.request_id, closure)).toMatchObject({ refund_amount: '29.99' });
  });
  test('return closure requires its parcel and approval', async () => {
    const value = await createAfterSales(7, 10, { type: 'return', reason: 'test' });
    await expect(service().completeAfterSales(2, value.request_id, closure)).rejects.toMatchObject({ statusCode: 409 });
    await reviewAfterSales(2, value.request_id, { status: 'approved', note: 'test' });
    await expect(service().completeAfterSales(2, value.request_id, closure)).rejects.toMatchObject({ statusCode: 409 });
  });
  test.each(['30.00', '29.991', '-1', 'NaN', '1e1'])('invalid or excessive refund %s is rejected without completion', async amount => {
    const value = await approved('refund');
    await expect(service().completeAfterSales(2, value.request_id, { ...closure, refund_amount: amount })).rejects.toMatchObject({ statusCode: 400 });
    expect((await service().getAfterSales(7, 10))?.completed_at).toBeNull();
  });
  test('demo payments cannot record a real refund, but may close with zero and a note', async () => {
    await db.query("UPDATE orders SET payment_method='demo' WHERE order_id=10");
    const value = await approved('refund');
    await expect(service().completeAfterSales(2, value.request_id, closure)).rejects.toMatchObject({ statusCode: 400 });
    expect(await service().completeAfterSales(2, value.request_id, { refund_amount: '0.00', note: 'Demo: no payment taken' })).toMatchObject({ refund_amount: '0.00', refund_reference: null });
  });
  test('concurrent closure has one winner and one completion audit', async () => {
    const value = await approved('refund');
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => service().completeAfterSales(2, value.request_id, closure)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.statusCode)).toEqual([409, 409, 409]);
    const [audit] = await db.query<RowDataPacket[]>("SELECT * FROM admin_logs WHERE action='COMPLETE_AFTER_SALES'"); expect(audit).toHaveLength(1);
  });
  test('audit insertion failure rolls back the closure record', async () => {
    const value = await approved('refund');
    await expect(service().completeAfterSales(999, value.request_id, closure)).rejects.toBeDefined();
    expect((await service().getAfterSales(7, 10))?.completed_at).toBeNull();
  });
  test('progress migration preserves a legacy approved request and is repeatable', async () => {
    const value = await approved();
    const migration = require('../../database/migrate-after-sales-progress');
    const names = Object.keys(migration.AFTER_SALES_PROGRESS_COLUMNS);
    await db.query(`ALTER TABLE after_sales_requests ${names.map(name => `DROP COLUMN ${name}`).join(',')}`);
    expect((await migration.checkAfterSalesProgress(db)).status).toBe('migration_required');
    await migration.migrateAfterSalesProgress(db); await migration.migrateAfterSalesProgress(db);
    expect(await migration.checkAfterSalesProgress(db)).toEqual({ status: 'ready', missing: [] });
    const current = await getAfterSales(7, 10);
    expect(current).toMatchObject({ request_id: value.request_id, status: 'approved', reason: 'private reason', review_note: 'private approval' });
    for (const name of names) expect(current![name]).toBeNull();
  });
});
