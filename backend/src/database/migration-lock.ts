import type { Pool, RowDataPacket } from 'mysql2/promise';

// 按数据库区分锁名：同一 MySQL 实例上的其他数据库不会互相阻塞
const LOCK_NAME = "CONCAT('ecommerce_migrate:', DATABASE())";

/**
 * 在 MySQL 命名锁内执行迁移，防止两次部署同时对同一数据库执行 ALTER。
 * 锁绑定在专用连接上：进程崩溃或连接断开时 MySQL 会自动释放。
 * @param waitSeconds 等待其他迁移结束的秒数，超时则报错退出
 */
export async function withMigrationLock<T>(pool: Pool, fn: () => Promise<T>, waitSeconds = 30): Promise<T> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT GET_LOCK(${LOCK_NAME}, ?) AS acquired`, [waitSeconds]);
    if (rows[0]?.acquired !== 1) throw new Error('另一个数据库迁移正在运行，请等待它完成后重试');
    try {
      return await fn();
    } finally {
      await conn.query(`SELECT RELEASE_LOCK(${LOCK_NAME}) AS released`).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
}
