import fs from 'node:fs';
import path from 'node:path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import runAdminMigrations from '../../database/admin-migrate';

// Replace only the application's connection selection; migration SQL uses the real isolated pool.
jest.mock('../../database/mysql', () => ({ connectDatabase: jest.fn(), getPool: jest.fn() }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;

integration('真实 MySQL 优惠券权限初始化', () => {
  const database = `admin_coupon_migrate_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 2,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);

    const source = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    const tables = new Set(['roles', 'admins', 'permissions', 'role_permissions']);
    for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (tables.delete(match[2])) await db.query(match[1]);
    }
    expect(tables.size).toBe(0);

    // ID 1 deliberately belongs to a normal role; the existing super administrator is ID 7.
    await db.query(`INSERT INTO roles (role_id, role_name, description) VALUES
      (1, 'product_admin', '已有商品角色描述'),
      (7, 'super_admin', '已有超级管理员描述'),
      (9, 'legacy_support', '保留自定义角色')`);
    await db.query(`INSERT INTO permissions
      (permission_id, permission_name, permission_code, resource, action, description) VALUES
      (50, '定制商品查看', 'product:view', 'product', 'view', '保留既有权限定义'),
      (51, '旧客服权限', 'legacy:review', 'legacy', 'view', '保留自定义权限')`);
    await db.query(`INSERT INTO role_permissions (id, role_id, permission_id) VALUES (70, 1, 50), (71, 9, 51)`);
    await db.query(`INSERT INTO admins
      (admin_id, username, password_hash, real_name, email, role_id, status, auth_version) VALUES
      (42, 'legacy_admin', 'existing-hash', '既有管理员', 'legacy@example.test', 1, 1, 3)`);
  }, 30000);

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  }, 30000);

  async function existingData() {
    const queries = [
      'SELECT * FROM roles WHERE role_id IN (1, 7, 9) ORDER BY role_id',
      'SELECT * FROM permissions WHERE permission_id IN (50, 51) ORDER BY permission_id',
      'SELECT * FROM role_permissions WHERE id IN (70, 71) ORDER BY id',
      'SELECT * FROM admins WHERE admin_id = 42',
    ];
    return Promise.all(queries.map(async sql => (await db.query<RowDataPacket[]>(sql))[0]));
  }

  async function initializedData() {
    const queries = [
      'SELECT * FROM roles ORDER BY role_id',
      'SELECT * FROM permissions ORDER BY permission_id',
      'SELECT * FROM role_permissions ORDER BY id',
      'SELECT * FROM admins ORDER BY admin_id',
    ];
    return Promise.all(queries.map(async sql => (await db.query<RowDataPacket[]>(sql))[0]));
  }

  test('角色 ID 顺序不同仍只给超级管理员默认优惠券权限，重复初始化保留既有数据', async () => {
    const env = { ...process.env };
    try {
      // Exercise production initialization without creating any bootstrap account.
      process.env.NODE_ENV = 'production'; delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
      const existing = await existingData();
      await runAdminMigrations();

      const [definitions] = await db.query<RowDataPacket[]>(`
        SELECT permission_code, resource, action FROM permissions
        WHERE resource = 'coupon' ORDER BY permission_code`);
      expect(definitions).toEqual([
        { permission_code: 'coupon:create', resource: 'coupon', action: 'create' },
        { permission_code: 'coupon:edit', resource: 'coupon', action: 'edit' },
        { permission_code: 'coupon:view', resource: 'coupon', action: 'view' },
      ]);
      const [grants] = await db.query<RowDataPacket[]>(`
        SELECT r.role_id, r.role_name, p.permission_code
        FROM role_permissions rp
        JOIN roles r ON r.role_id = rp.role_id
        JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE p.resource = 'coupon' ORDER BY p.permission_code, r.role_id`);
      expect(grants).toEqual([
        { role_id: 7, role_name: 'super_admin', permission_code: 'coupon:create' },
        { role_id: 7, role_name: 'super_admin', permission_code: 'coupon:edit' },
        { role_id: 7, role_name: 'super_admin', permission_code: 'coupon:view' },
      ]);
      const [ordinaryGrants] = await db.query<RowDataPacket[]>(`
        SELECT rp.role_id, p.permission_code FROM role_permissions rp
        JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE rp.role_id <> 7 ORDER BY rp.role_id, p.permission_code`);
      expect(ordinaryGrants).toEqual([
        { role_id: 1, permission_code: 'product:view' },
        { role_id: 9, permission_code: 'legacy:review' },
      ]);
      expect(await existingData()).toEqual(existing);

      const initialized = await initializedData();
      await runAdminMigrations();
      expect(await initializedData()).toEqual(initialized);
      expect(await existingData()).toEqual(existing);
    } finally { process.env = env; }
  }, 30000);
});
