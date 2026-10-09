// Local-only real MySQL fixture. Never reads cloud environment files or uses DB_NAME.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const backend = path.resolve(__dirname, '..');
// Migrations import load-env; the fixture must keep its explicit local configuration.
require('dotenv').config = () => ({});
const host = process.env.MYSQL_TEST_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('E2E fixture requires a loopback database host');
const database = `ecommerce_e2e_${process.pid}`;
const options = {
  ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } :
    { host, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
  user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
  timezone: '+00:00', connectionLimit: 6,
};
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PAYMENT_MODE = 'demo';
process.env.JWT_SECRET = 'isolated-browser-fixture-only-secret';
process.env.CORS_ORIGIN = 'http://127.0.0.1:3100';
process.env.ADMIN_BOOTSTRAP_PASSWORD = 'BrowserFixtureAdmin123!';
// The complete commerce flow shares one loopback IP and has no customer think time.
// A fast runner can make more than 500 API reads in one minute across the recovery flows.
// Keep a fixture-only budget; middleware/Redis suites verify production limiter behavior.
process.env.RATE_LIMIT_MAX = '2000';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
let owner, pool, listener, created = false, stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (listener) await new Promise(resolve => listener.close(resolve));
  if (pool) await pool.end();
  if (owner) {
    if (created) await owner.query(`DROP DATABASE ${database}`);
    await owner.end();
  }
}
process.on('SIGTERM', () => stop().then(() => process.exit(0)));
process.on('SIGINT', () => stop().then(() => process.exit(0)));
(async () => {
  owner = mysql.createPool(options);
  await owner.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
  created = true;
  pool = mysql.createPool({ ...options, database });
  const db = require(path.join(backend, 'dist/database/mysql'));
  db.connectDatabase = async () => undefined;
  db.getPool = () => pool;
  db.query = async (sql, params) => (await pool.query(sql, params))[0];
  // Cache is an explicitly isolated boundary; order/account persistence is real SQL.
  require(path.join(backend, 'dist/database/redis')).getRedisClient = () => ({
    get: async () => null, setex: async () => 'OK', del: async () => 1, keys: async () => [],
  });
  const schema = fs.readFileSync(path.join(backend, 'src/database/migrate.ts'), 'utf8');
  for (const match of schema.matchAll(/`(CREATE TABLE IF NOT EXISTS \w+[\s\S]*?)`/g)) await pool.query(match[1]);
  for (const [file, method] of [
    ['migrate-coupon', 'migrateCouponTables'], ['migrate-sku', 'migrateSkuTables'],
    ['migrate-address', 'migrateAddressTables'], ['migrate-review', 'migrateReviewTables'],
    ['migrate-account-security', 'migrateAccountSecurity'], ['migrate-fulfillment', 'migrateFulfillment'],
    ['migrate-after-sales-progress', 'migrateAfterSalesProgress'],
    ['migrate-product-i18n', 'migrateProductI18n'],
    ['migrate-product-creations', 'migrateProductCreations'],
  ]) await require(path.join(backend, `dist/database/${file}`))[method](pool);
  await require(path.join(backend, 'dist/database/admin-migrate')).default();
  await pool.query("INSERT INTO categories(category_id,name) VALUES(1,'浏览器测试分类')");
  await pool.query(`INSERT INTO products(product_id,title,title_en,description,description_en,specs,specs_en,category_id,price,stock,status)
    VALUES(1,'浏览器交易测试商品','Browser checkout product','浏览器中文描述','Browser English description',?,?,1,10.10,20,1)`,
    [JSON.stringify({ 材质: '棉' }), JSON.stringify({ 材质: { name: 'Material', value: 'Cotton' } })]);
  await pool.query("INSERT INTO products(product_id,title,title_en,category_id,price,original_price,stock,status) VALUES(2,'浏览器规格价格商品','Browser variant product',1,99.00,150.00,0,1)");
  await pool.query(`INSERT INTO product_skus(sku_id,product_id,sku_code,specs,specs_en,price,original_price,stock,status) VALUES
    (201,2,'PRICE-SALE','{"颜色":"红色"}',?,99.00,100.00,3,1),
    (202,2,'PRICE-EQUAL','{"颜色":"蓝色"}',?,100.00,100.00,3,1),
    (203,2,'PRICE-NONE','{"颜色":"绿色"}',?,150.00,NULL,3,1)`,
    ['Red', 'Blue', 'Green'].map(value => JSON.stringify({ 颜色: { name: 'Color', value } })));
  const app = require(path.join(backend, 'dist/app')).createApp();
  for (let id = 1; id <= 51; id++) {
    await pool.query(`INSERT INTO coupons(coupon_id,code,name,type,discount_value,total_quantity,remain_quantity,per_user_limit,start_time,end_time,created_at)
      VALUES(?, ?, ?, 3, 5, ?, ?, 1, DATE_SUB(NOW(),INTERVAL 1 DAY), DATE_ADD(NOW(),INTERVAL 1 DAY), '2026-01-01 00:00:00')`,
      [id, `BROWSER${id}`, `浏览器优惠券${id}`, id === 1 ? 1 : 3, id === 1 ? 1 : 3]);
  }
  listener = app.listen(3101, '127.0.0.1', () => console.log('E2E fixture ready on 127.0.0.1:3101'));
})().catch(async () => { console.error('E2E fixture initialization failed'); await stop(); process.exit(1); });
