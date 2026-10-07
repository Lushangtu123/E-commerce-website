// Local-only real MySQL fixture. Never reads cloud environment files or uses DB_NAME.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const backend = path.resolve(__dirname, '..');
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
// Limiter behavior is verified separately by middleware/Redis regression tests.
process.env.RATE_LIMIT_MAX = '500';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
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
  ]) await require(path.join(backend, `dist/database/${file}`))[method](pool);
  await require(path.join(backend, 'dist/database/admin-migrate')).default();
  await pool.query("INSERT INTO products(product_id,title,price,stock,status) VALUES(1,'浏览器交易测试商品',10.10,20,1)");
  const app = require(path.join(backend, 'dist/app')).createApp();
  listener = app.listen(3101, '127.0.0.1', () => console.log('E2E fixture ready on 127.0.0.1:3101'));
})().catch(async () => { console.error('E2E fixture initialization failed'); await stop(); process.exit(1); });
