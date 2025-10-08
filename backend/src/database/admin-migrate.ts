import { connectDatabase, getPool } from './mysql';

async function runAdminMigrations() {
  // 首先连接数据库
  await connectDatabase();
  const pool = getPool();
  const connection = await pool.getConnection();
  
  try {
    console.log('开始执行管理员系统数据库迁移...\n');

    // 1. 创建角色表
    console.log('创建角色表...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS roles (
        role_id INT PRIMARY KEY AUTO_INCREMENT,
        role_name VARCHAR(50) NOT NULL UNIQUE,
        description VARCHAR(200),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_role_name (role_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. 创建管理员表
    console.log('创建管理员表...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admins (
        admin_id BIGINT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        real_name VARCHAR(50),
        email VARCHAR(100),
        phone VARCHAR(20),
        role_id INT,
        status TINYINT DEFAULT 1 COMMENT '1:启用 0:禁用',
        last_login_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles(role_id),
        INDEX idx_username (username),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. 创建权限表
    console.log('创建权限表...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        permission_id INT PRIMARY KEY AUTO_INCREMENT,
        permission_name VARCHAR(100) NOT NULL,
        permission_code VARCHAR(50) UNIQUE NOT NULL,
        resource VARCHAR(50) COMMENT '资源类型: product, user, order, statistics',
        action VARCHAR(20) COMMENT '操作: view, create, edit, delete',
        description VARCHAR(200),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_code (permission_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4. 创建角色权限关联表
    console.log('创建角色权限关联表...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        role_id INT NOT NULL,
        permission_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_role_permission (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(permission_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5. 创建操作日志表
    console.log('创建操作日志表...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        log_id BIGINT PRIMARY KEY AUTO_INCREMENT,
        admin_id BIGINT NOT NULL,
        action VARCHAR(50) NOT NULL,
        resource_type VARCHAR(50),
        resource_id VARCHAR(100),
        description TEXT,
        ip_address VARCHAR(50),
        user_agent VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_admin (admin_id),
        INDEX idx_action (action),
        INDEX idx_created (created_at),
        FOREIGN KEY (admin_id) REFERENCES admins(admin_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 6. 创建流量统计表
    console.log('创建流量统计表...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS traffic_statistics (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        date DATE NOT NULL,
        hour TINYINT COMMENT '0-23',
        page_views INT DEFAULT 0,
        unique_visitors INT DEFAULT 0,
        new_users INT DEFAULT 0,
        bounce_rate DECIMAL(5,2),
        avg_session_duration INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_date_hour (date, hour),
        INDEX idx_date (date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 7. 创建页面访问记录表
    console.log('创建页面访问记录表...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS page_visits (
        visit_id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NULL,
        session_id VARCHAR(100),
        page_url VARCHAR(500),
        referrer VARCHAR(500),
        ip_address VARCHAR(50),
        user_agent VARCHAR(500),
        device_type VARCHAR(20) COMMENT 'mobile, desktop, tablet',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        INDEX idx_session (session_id),
        INDEX idx_created (created_at),
        INDEX idx_page (page_url(255))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('\n✓ 所有管理员系统表创建成功！\n');

    // 插入初始数据
    console.log('插入初始角色数据...');
    await connection.query(`
      INSERT IGNORE INTO roles (role_name, description) VALUES
      ('super_admin', '超级管理员 - 拥有所有权限'),
      ('product_admin', '商品管理员 - 管理商品上下架'),
      ('order_admin', '订单管理员 - 查看订单和用户信息'),
      ('data_analyst', '数据分析师 - 查看统计数据')
    `);

    console.log('插入初始权限数据...');
    await connection.query(`
      INSERT IGNORE INTO permissions (permission_name, permission_code, resource, action, description) VALUES
      ('查看商品', 'product:view', 'product', 'view', '查看商品列表和详情'),
      ('创建商品', 'product:create', 'product', 'create', '创建新商品'),
      ('编辑商品', 'product:edit', 'product', 'edit', '编辑商品信息'),
      ('删除商品', 'product:delete', 'product', 'delete', '删除商品'),
      ('查看用户', 'user:view', 'user', 'view', '查看用户列表和详情'),
      ('编辑用户', 'user:edit', 'user', 'edit', '编辑用户信息'),
      ('删除用户', 'user:delete', 'user', 'delete', '删除用户'),
      ('查看订单', 'order:view', 'order', 'view', '查看订单列表和详情'),
      ('编辑订单', 'order:edit', 'order', 'edit', '编辑订单状态'),
      ('导出订单', 'order:export', 'order', 'export', '导出订单数据'),
      ('查看统计', 'statistics:view', 'statistics', 'view', '查看统计数据'),
      ('查看日志', 'log:view', 'log', 'view', '查看操作日志'),
      ('管理权限', 'permission:manage', 'permission', 'manage', '管理角色和权限')
    `);

    // 为超级管理员分配所有权限
    console.log('为超级管理员分配权限...');
    await connection.query(`
      INSERT IGNORE INTO role_permissions (role_id, permission_id)
      SELECT 1, permission_id FROM permissions
    `);

    // 创建默认管理员账号（密码：admin123）
    console.log('创建默认管理员账号...');
    const bcrypt = require('bcryptjs');
    const defaultPassword = await bcrypt.hash('admin123', 10);
    
    await connection.query(`
      INSERT IGNORE INTO admins (username, password_hash, real_name, email, role_id, status)
      VALUES ('admin', ?, '系统管理员', 'admin@example.com', 1, 1)
    `, [defaultPassword]);

    console.log('\n✓ 初始数据插入成功！');
    console.log('\n默认管理员账号:');
    console.log('用户名: admin');
    console.log('密码: admin123');
    console.log('请登录后立即修改密码！\n');

  } catch (error) {
    console.error('迁移失败:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// 如果直接运行此文件
if (require.main === module) {
  runAdminMigrations()
    .then(() => {
      console.log('管理员系统初始化完成！');
      process.exit(0);
    })
    .catch((error) => {
      console.error('初始化失败:', error);
      process.exit(1);
    });
}

export default runAdminMigrations;

