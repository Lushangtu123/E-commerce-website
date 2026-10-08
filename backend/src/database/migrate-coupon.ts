/**
 * 优惠券系统数据库迁移
 */
import { connectDatabase, getPool } from './mysql';
import { Pool, RowDataPacket } from 'mysql2/promise';
import logger from '../utils/logger';
import { migrateCouponClaims } from './migrate-coupon-claims';

export async function migrateCouponTables(pool: Pool) {
  try {
    logger.info('🚀 开始创建优惠券相关表...');

    // 1. 优惠券表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS coupons (
        coupon_id INT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(50) UNIQUE NOT NULL COMMENT '优惠券代码',
        name VARCHAR(100) NOT NULL COMMENT '优惠券名称',
        description TEXT COMMENT '优惠券描述',
        type TINYINT NOT NULL COMMENT '类型: 1=满减, 2=折扣, 3=无门槛',
        discount_value DECIMAL(10,2) NOT NULL COMMENT '优惠值：金额或减免百分比，20表示优惠20%即8折',
        min_amount DECIMAL(10,2) DEFAULT 0 COMMENT '最低使用金额',
        max_discount DECIMAL(10,2) DEFAULT NULL COMMENT '最大优惠金额（折扣券用）',
        total_quantity INT NOT NULL COMMENT '总发放数量',
        remain_quantity INT NOT NULL COMMENT '剩余数量',
        per_user_limit INT DEFAULT 1 COMMENT '每人限领数量',
        start_time DATETIME NOT NULL COMMENT '生效时间',
        end_time DATETIME NOT NULL COMMENT '失效时间',
        status TINYINT DEFAULT 1 COMMENT '状态: 0=禁用, 1=启用',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_code (code),
        INDEX idx_status (status),
        INDEX idx_time (start_time, end_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='优惠券表';
    `);
    logger.info('✅ coupons 表创建成功');

    // 2. 用户优惠券表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS user_coupons (
        user_coupon_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL COMMENT '用户ID',
        coupon_id INT NOT NULL COMMENT '优惠券ID',
        status TINYINT DEFAULT 1 COMMENT '状态: 1=未使用, 2=已使用, 3=已过期',
        used_at DATETIME DEFAULT NULL COMMENT '使用时间',
        order_id BIGINT DEFAULT NULL COMMENT '占用或使用订单ID',
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '领取时间',
        expired_at DATETIME NOT NULL COMMENT '过期时间',
        INDEX idx_user (user_id),
        INDEX idx_coupon (coupon_id),
        INDEX idx_status (status),
        INDEX idx_expired (expired_at),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (coupon_id) REFERENCES coupons(coupon_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户优惠券表';
    `);
    logger.info('✅ user_coupons 表创建成功');

    // 3. 优惠券使用记录表（不使用外键约束，避免类型不匹配问题）
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS coupon_usage_logs (
        log_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL COMMENT '用户ID',
        coupon_id INT NOT NULL COMMENT '优惠券ID',
        user_coupon_id INT NOT NULL COMMENT '用户优惠券ID',
        order_id BIGINT NOT NULL COMMENT '订单ID',
        discount_amount DECIMAL(10,2) NOT NULL COMMENT '优惠金额',
        order_amount DECIMAL(10,2) NOT NULL COMMENT '订单金额',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '使用时间',
        INDEX idx_user (user_id),
        INDEX idx_coupon (coupon_id),
        INDEX idx_order (order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='优惠券使用记录表';
    `);
    logger.info('✅ coupon_usage_logs 表创建成功');

    // CREATE IF NOT EXISTS also runs on existing databases; explicitly upgrade their columns.
    const [orderColumns] = await pool.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
    );
    if (orderColumns.length === 0) throw new Error('请先运行基础数据库迁移创建 orders 表');
    const existing = new Set(orderColumns.map(column => column.COLUMN_NAME));
    const additions: Record<string, string> = {
      original_amount: 'DECIMAL(10,2) DEFAULT NULL',
      discount_amount: 'DECIMAL(10,2) NOT NULL DEFAULT 0',
      user_coupon_id: 'INT DEFAULT NULL',
      coupon_name: 'VARCHAR(100) DEFAULT NULL',
      coupon_code: 'VARCHAR(50) DEFAULT NULL',
    };
    for (const [column, definition] of Object.entries(additions)) {
      if (!existing.has(column)) await pool.query(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
    }
    await pool.query('UPDATE orders SET original_amount = total_amount WHERE original_amount IS NULL');
    for (const table of ['user_coupons', 'coupon_usage_logs']) {
      const [columns] = await pool.query<RowDataPacket[]>(
        'SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, 'order_id']
      );
      if (columns[0]?.DATA_TYPE !== 'bigint') {
        await pool.query(`ALTER TABLE ${table} MODIFY COLUMN order_id BIGINT ${table === 'user_coupons' ? 'DEFAULT NULL' : 'NOT NULL'}`);
      }
    }

    await migrateCouponClaims(pool);
    logger.info('🎉 优惠券相关表创建完成！');
  } catch (error) {
    logger.error({ err: error }, '❌ 创建优惠券表失败');
    throw error;
  }
}

// Importing the migration is side-effect free; only the CLI connects and runs it.
if (require.main === module) {
  connectDatabase()
    .then(() => migrateCouponTables(getPool()))
    .then(() => {
      logger.info('✅ 迁移任务完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ err: error }, '💥 迁移任务失败');
      process.exit(1);
    });
}
