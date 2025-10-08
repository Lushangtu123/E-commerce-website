# 后台管理系统使用指南

## 📋 目录

- [系统概述](#系统概述)
- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [功能详解](#功能详解)
- [API文档](#api文档)
- [数据库结构](#数据库结构)
- [常见问题](#常见问题)

## 系统概述

本系统是一个完整的电商后台管理系统，基于 RBAC（基于角色的访问控制）权限模型，提供商品管理、订单管理、用户管理、数据统计等核心功能。

### 技术栈

**后端：**
- Node.js + Express
- TypeScript
- MySQL (主数据库)
- Redis (缓存)
- JWT (认证)

**前端：**
- Next.js 14
- React
- TypeScript
- TailwindCSS
- Recharts (数据可视化)

## 功能特性

### ✅ 已实现功能

1. **管理员认证系统**
   - 管理员登录/登出
   - JWT Token认证
   - 角色权限管理
   - 操作日志记录

2. **仪表盘 (Dashboard)**
   - 核心业务指标展示
   - 今日订单/销售额/新用户统计
   - 销售趋势图表
   - 热门商品排行
   - 最近订单列表

3. **商品管理**
   - 商品列表查询（支持搜索、筛选）
   - 商品上下架
   - 批量操作
   - 商品信息编辑
   - 商品状态管理

4. **订单管理**
   - 订单列表查询
   - 订单详情查看
   - 订单状态更新
   - 订单统计分析

5. **用户管理**
   - 用户列表查询
   - 用户详情查看
   - 用户状态管理（启用/禁用）
   - 用户订单历史
   - 用户统计数据

6. **操作日志**
   - 所有管理员操作记录
   - 操作时间/IP/类型记录
   - 日志查询和筛选

## 快速开始

### 1. 启动服务

确保 Docker 正在运行，然后启动所有服务：

```bash
cd /Users/chenyinqi/E-commerce-website
docker-compose up -d
```

### 2. 初始化管理员数据库

```bash
# 进入后端容器
docker-compose exec backend sh

# 运行管理员数据库迁移
npm run build
node dist/database/admin-migrate.js

# 退出容器
exit
```

这将创建以下内容：
- ✅ 管理员相关数据表
- ✅ 4个预设角色
- ✅ 13个权限
- ✅ 默认管理员账号

### 3. 登录管理后台

访问：http://localhost:3000/admin/login

**默认管理员账号：**
- 用户名：`admin`
- 密码：`admin123`

⚠️ **重要：** 首次登录后请立即修改密码！

### 4. 重启服务

```bash
# 重新构建并启动前端（包含新的管理员页面）
docker-compose restart frontend
```

## 功能详解

### 仪表盘 (Dashboard)

路径：`/admin/dashboard`

**展示内容：**
- 📊 今日核心指标（订单数、销售额、新用户、在售商品）
- 📈 销售趋势图（最近7天）
- 🏆 热门商品排行（最近7天）
- 📋 最近订单列表

### 商品管理

路径：`/admin/products`

**功能：**
- 🔍 搜索商品（按名称）
- 🎯 筛选（上架/下架状态）
- ⬆️⬇️ 单个商品上下架
- ✅ 批量上下架
- ✏️ 编辑商品信息
- 🗑️ 删除商品（软删除）

**操作流程：**
1. 选择要操作的商品（勾选复选框）
2. 点击"批量上架"或"批量下架"
3. 或点击单个商品的"上架"/"下架"按钮

### 订单管理

路径：`/admin/orders`

**功能：**
- 🔍 搜索订单（按订单号）
- 🎯 筛选（按订单状态）
- 👁️ 查看订单详情
- 🔄 更新订单状态
- 📊 订单统计分析

**订单状态：**
- 0: 待支付
- 1: 已支付
- 2: 待发货
- 3: 已发货
- 4: 已完成
- 5: 已取消

### 用户管理

路径：`/admin/users`

**功能：**
- 🔍 搜索用户（用户名/邮箱/手机号）
- 🎯 筛选（正常/已禁用）
- 👁️ 查看用户详情
- 🔒 禁用/启用用户
- 📊 用户消费统计

### 操作日志

路径：`/admin/logs`

**记录内容：**
- 操作人
- 操作类型
- 操作描述
- IP地址
- 操作时间

**主要操作类型：**
- `LOGIN` - 登录
- `CREATE_PRODUCT` - 创建商品
- `UPDATE_PRODUCT` - 更新商品
- `DELETE_PRODUCT` - 删除商品
- `UPDATE_PRODUCT_STATUS` - 更新商品状态
- `UPDATE_ORDER_STATUS` - 更新订单状态
- `UPDATE_USER_STATUS` - 更新用户状态

## API文档

### 管理员认证

#### POST `/api/admin/login`
管理员登录

**请求体：**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**响应：**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "admin": {
    "admin_id": 1,
    "username": "admin",
    "real_name": "系统管理员",
    "role_name": "super_admin"
  }
}
```

#### GET `/api/admin/profile`
获取管理员信息（需要认证）

**Headers：**
```
Authorization: Bearer <token>
```

**响应：**
```json
{
  "admin": { ... },
  "permissions": [
    { "permission_code": "product:view", ... },
    ...
  ]
}
```

### 仪表盘API

#### GET `/api/admin/dashboard/stats`
获取仪表盘统计数据

#### GET `/api/admin/dashboard/recent-orders?limit=5`
获取最近订单

#### GET `/api/admin/dashboard/top-products?days=7&limit=5`
获取热门商品

#### GET `/api/admin/dashboard/sales-trend?days=7`
获取销售趋势

### 商品管理API

#### GET `/api/admin/products`
获取商品列表（需要 `product:view` 权限）

**参数：**
- `page` - 页码（默认1）
- `limit` - 每页数量（默认20）
- `keyword` - 搜索关键词
- `categoryId` - 分类ID
- `status` - 状态（0/1）

#### PUT `/api/admin/products/:productId/status`
更新商品状态（需要 `product:edit` 权限）

**请求体：**
```json
{
  "status": 1
}
```

#### PUT `/api/admin/products/batch/status`
批量更新商品状态

**请求体：**
```json
{
  "productIds": [1, 2, 3],
  "status": 1
}
```

### 订单管理API

#### GET `/api/admin/orders`
获取订单列表（需要 `order:view` 权限）

#### GET `/api/admin/orders/:orderId`
获取订单详情

#### PUT `/api/admin/orders/:orderId/status`
更新订单状态（需要 `order:edit` 权限）

### 用户管理API

#### GET `/api/admin/users`
获取用户列表（需要 `user:view` 权限）

#### GET `/api/admin/users/:userId`
获取用户详情

#### PUT `/api/admin/users/:userId/status`
更新用户状态（需要 `user:edit` 权限）

#### GET `/api/admin/users/:userId/orders`
获取用户订单列表

### 日志API

#### GET `/api/admin/logs`
获取操作日志（需要 `log:view` 权限）

**参数：**
- `page` - 页码
- `limit` - 每页数量
- `action` - 操作类型
- `adminId` - 管理员ID
- `startDate` - 开始日期
- `endDate` - 结束日期

## 数据库结构

### 角色表 (roles)

| 字段 | 类型 | 说明 |
|------|------|------|
| role_id | INT | 角色ID |
| role_name | VARCHAR(50) | 角色名称 |
| description | VARCHAR(200) | 角色描述 |

**预设角色：**
- `super_admin` - 超级管理员（拥有所有权限）
- `product_admin` - 商品管理员
- `order_admin` - 订单管理员
- `data_analyst` - 数据分析师

### 管理员表 (admins)

| 字段 | 类型 | 说明 |
|------|------|------|
| admin_id | BIGINT | 管理员ID |
| username | VARCHAR(50) | 用户名 |
| password_hash | VARCHAR(255) | 密码哈希 |
| real_name | VARCHAR(50) | 真实姓名 |
| email | VARCHAR(100) | 邮箱 |
| role_id | INT | 角色ID |
| status | TINYINT | 状态（1:启用 0:禁用） |
| last_login_at | TIMESTAMP | 最后登录时间 |

### 权限表 (permissions)

| 字段 | 类型 | 说明 |
|------|------|------|
| permission_id | INT | 权限ID |
| permission_name | VARCHAR(100) | 权限名称 |
| permission_code | VARCHAR(50) | 权限代码 |
| resource | VARCHAR(50) | 资源类型 |
| action | VARCHAR(20) | 操作类型 |

**权限列表：**
- `product:view` - 查看商品
- `product:create` - 创建商品
- `product:edit` - 编辑商品
- `product:delete` - 删除商品
- `user:view` - 查看用户
- `user:edit` - 编辑用户
- `user:delete` - 删除用户
- `order:view` - 查看订单
- `order:edit` - 编辑订单
- `order:export` - 导出订单
- `statistics:view` - 查看统计
- `log:view` - 查看日志
- `permission:manage` - 管理权限

### 操作日志表 (admin_logs)

| 字段 | 类型 | 说明 |
|------|------|------|
| log_id | BIGINT | 日志ID |
| admin_id | BIGINT | 管理员ID |
| action | VARCHAR(50) | 操作类型 |
| resource_type | VARCHAR(50) | 资源类型 |
| resource_id | VARCHAR(100) | 资源ID |
| description | TEXT | 操作描述 |
| ip_address | VARCHAR(50) | IP地址 |
| user_agent | VARCHAR(500) | 用户代理 |
| created_at | TIMESTAMP | 创建时间 |

## 常见问题

### 1. 如何添加新的管理员？

目前系统只有一个默认管理员账号。添加新管理员需要直接操作数据库：

```sql
-- 插入新管理员（密码需要先用bcrypt加密）
INSERT INTO admins (username, password_hash, real_name, email, role_id, status)
VALUES ('newadmin', '$2a$10$...', '新管理员', 'new@example.com', 1, 1);
```

### 2. 如何修改管理员密码？

```sql
-- 更新密码（密码需要先用bcrypt加密）
UPDATE admins 
SET password_hash = '$2a$10$...' 
WHERE username = 'admin';
```

### 3. Token过期怎么办？

Token有效期为24小时，过期后需要重新登录。

### 4. 如何自定义权限？

1. 在 `permissions` 表中添加新权限
2. 在 `role_permissions` 表中为角色分配权限
3. 在API中使用 `requirePermission('permission:code')` 中间件

### 5. 如何查看管理员操作记录？

访问 `/admin/logs` 页面，可以查看所有管理员的操作历史。

### 6. 前端图表不显示怎么办？

确保已安装 recharts：

```bash
cd frontend
npm install recharts
```

### 7. 如何重置管理员数据库？

```bash
# 进入MySQL容器
docker-compose exec mysql mysql -u ecommerce -pecommerce123 ecommerce

# 删除所有管理员相关表
DROP TABLE IF EXISTS admin_logs;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS roles;

# 退出MySQL
exit

# 重新运行迁移脚本
docker-compose exec backend node dist/database/admin-migrate.js
```

## 安全建议

1. ⚠️ **立即修改默认密码**
2. 🔒 使用强密码（至少8位，包含大小写字母、数字、特殊字符）
3. 🚫 不要在生产环境使用默认的 JWT_SECRET
4. 📝 定期查看操作日志
5. 🔐 为不同角色分配最小权限
6. 🌐 使用 HTTPS 部署
7. 🛡️ 配置防火墙规则

## 后续开发计划

- [ ] 管理员账号管理界面
- [ ] 角色和权限管理界面
- [ ] 数据导出功能
- [ ] 更多统计图表
- [ ] 实时通知系统
- [ ] 操作审计功能
- [ ] 二次认证(2FA)
- [ ] 密码修改功能

## 技术支持

如有问题，请查看：
- [项目README](README.md)
- [快速开始指南](QUICKSTART.md)
- [故障排查](TROUBLESHOOTING.md)
- [更新日志](CHANGELOG.md)

---

**版本**: 1.0.0  
**更新日期**: 2025年10月8日  
**维护者**: AI Assistant

