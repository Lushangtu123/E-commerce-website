/**
 * 优惠券系统数据库迁移
 */
import { connectDatabase, getPool } from './mysql';

async function migrateCouponTables() {
  try {
    console.log('🚀 开始创建优惠券相关表...');

    // 连接数据库
    await connectDatabase();
    const pool = getPool();

    // 1. 优惠券表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS coupons (
        coupon_id INT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(50) UNIQUE NOT NULL COMMENT '优惠券代码',
        name VARCHAR(100) NOT NULL COMMENT '优惠券名称',
        description TEXT COMMENT '优惠券描述',
        type TINYINT NOT NULL COMMENT '类型: 1=满减, 2=折扣, 3=无门槛',
        discount_value DECIMAL(10,2) NOT NULL COMMENT '优惠值（满减为金额，折扣为折扣率）',
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
    console.log('✅ coupons 表创建成功');

    // 2. 用户优惠券表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS user_coupons (
        user_coupon_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL COMMENT '用户ID',
        coupon_id INT NOT NULL COMMENT '优惠券ID',
        status TINYINT DEFAULT 1 COMMENT '状态: 1=未使用, 2=已使用, 3=已过期',
        used_at DATETIME DEFAULT NULL COMMENT '使用时间',
        order_id INT DEFAULT NULL COMMENT '使用订单ID',
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
    console.log('✅ user_coupons 表创建成功');

    // 3. 优惠券使用记录表（不使用外键约束，避免类型不匹配问题）
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS coupon_usage_logs (
        log_id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL COMMENT '用户ID',
        coupon_id INT NOT NULL COMMENT '优惠券ID',
        user_coupon_id INT NOT NULL COMMENT '用户优惠券ID',
        order_id INT NOT NULL COMMENT '订单ID',
        discount_amount DECIMAL(10,2) NOT NULL COMMENT '优惠金额',
        order_amount DECIMAL(10,2) NOT NULL COMMENT '订单金额',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '使用时间',
        INDEX idx_user (user_id),
        INDEX idx_coupon (coupon_id),
        INDEX idx_order (order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='优惠券使用记录表';
    `);
    console.log('✅ coupon_usage_logs 表创建成功');

    console.log('🎉 优惠券相关表创建完成！');
  } catch (error) {
    console.error('❌ 创建优惠券表失败:', error);
    throw error;
  }
}

// 执行迁移
migrateCouponTables()
  .then(() => {
    console.log('✅ 迁移任务完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 迁移任务失败:', error);
    process.exit(1);
  });

