import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let pool: mysql.Pool;
let connecting: Promise<void> | undefined;

export async function connectDatabase(): Promise<void> {
  if (pool) return;
  if (connecting) return connecting;
  connecting = initializeDatabase();
  try { await connecting; } finally { connecting = undefined; }
}

async function initializeDatabase(): Promise<void> {
  const candidate = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ecommerce',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || (process.env.VERCEL ? 2 : 10)),
    connectTimeout: 10000,
    ...(process.env.DB_SSL === 'true' ? { ssl: {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA_BASE64 ? { ca: Buffer.from(process.env.DB_SSL_CA_BASE64, 'base64').toString('utf8') }
        : process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
    } } : {}),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
    timezone: '+00:00'
  });

  let connection: mysql.PoolConnection | undefined;
  try {
    connection = await candidate.getConnection();
    await connection.ping();
    pool = candidate;
  } catch (error) {
    // Failed cold starts must not leak pools or prevent the next request from retrying.
    if (connection) { connection.release(); connection = undefined; }
    await candidate.end().catch(() => undefined);
    throw error;
  } finally {
    connection?.release();
  }
}

export function getPool(): mysql.Pool {
  if (!pool) {
    throw new Error('数据库未初始化');
  }
  return pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T> {
  const [rows] = await getPool().query(sql, params);
  return rows as T;
}

// 导出 pool 供其他模块使用
export { pool };
