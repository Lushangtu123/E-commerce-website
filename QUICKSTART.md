# 快速开始指南

本指南将帮助您快速启动和运行电商平台系统。

## 前置要求

请确保您的系统已安装以下软件：

- **Docker Desktop** 20.10+ [下载地址](https://www.docker.com/products/docker-desktop)
- **Docker Compose** 2.0+ (通常包含在Docker Desktop中)
- **Git** (用于克隆项目)

本地开发和 CI 使用 Node.js 24 LTS。

## 验证更新

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
cd ../frontend
npm ci
npm test
npm run build
```

后端默认测试不连接外部服务，真实 MySQL 集成测试默认跳过。CI 会在 MySQL 8.0 上执行全部测试；本地可指定独立测试服务器运行并发、重复支付/取消和回滚验证：

```bash
cd backend
MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD='填写测试数据库密码' \
  npm test -- --runInBand src/__tests__/integration
```

集成测试自动创建和删除以 `ecommerce_order_test_`、`ecommerce_coupon_migration_test_`、`ecommerce_sku_migration_test_`、`address_test_`、`ecom_address_migration_test_`、`profile_stats_test_` 开头的独立数据库，需要测试账号有建库权限，不读取应用的 `DB_NAME`。覆盖库存并发、优惠券占用/返还、地址归属和默认地址、订单收货快照、个人统计与分页隔离、失败回滚与旧库重复升级。也可通过 `MYSQL_TEST_SOCKET` 指定本机测试实例的 Unix socket；测试服务器使用 UTC 时区。

验证个人中心时，可对照订单、优惠券和收藏列表检查计数；「待支付」进入对应筛选。订单超过 10 条时可翻页，支持已取消筛选；取消最后一页的唯一待支付订单后，应自动返回有效页。统计接口为 `GET /api/users/stats`，只读取登录用户的数据。

## 更新已有数据库的优惠券结算

部署此版后端前，先备份数据库并执行增量迁移：

```bash
cd backend
npm run build
npm run migrate-coupon
# Docker 环境：docker-compose exec backend npm run migrate-coupon
```

迁移添加订单的原价、优惠额和优惠券快照字段，将优惠券绑定的订单 ID 升级为 BIGINT，保留已有订单、已用券和使用记录；可以重复执行。旧订单按原有实付金额回填原价，优惠额为 0。全新数据库运行 `npm run migrate` 会一起创建优惠券表。

购物车通过服务器预览金额并选择已领取的有效券。`discount_value=20` 表示优惠 20%（8 折），`max_discount` 为 null 或 0 表示不封顶。待支付订单会占用券；手动或超时取消后，有效券恢复可用，已过期券不再可用。支付保留已用状态，取消不增加发行余量。

## 更新已有数据库的规格购买

部署此版后端前，在维护窗口备份数据库并执行：

```bash
cd backend
npm run build
npm run migrate-coupon
npm run migrate-sku
# Docker 环境：docker-compose exec backend npm run migrate-sku
```

规格迁移给购物车增加规格标识和唯一约束，给订单明细增加规格编号、编码与规格快照；可重复执行，保留原购物车数量和历史订单。全新数据库的 `npm run migrate` 已包含这两项迁移。切换时停止旧版写入，再升级数据库并启动新版前后端，避免旧版购物车接口误改多个规格。

有规格的商品必须先在详情页选择规格。同商品的不同规格独立计价和扣库存；只有所选购物车行会在下单后移除。取消订单回补购买的原规格，即使规格已停用；旧无规格订单仍回补商品基础库存。已有购物车无规格行若对应商品后来增加了规格，会显示不可用，可删除后重新选择规格。

## 更新已有数据库的收货地址

在维护窗口停止旧版写入，备份数据库，再执行增量迁移并启动新版前后端：

```bash
cd backend
npm run build
npm run migrate-coupon
npm run migrate-sku
npm run migrate-address
# Docker 环境：docker-compose exec backend npm run migrate-address
```

地址迁移给订单增加 `shipping_address_snapshot` JSON 字段。旧订单仅在当前地址仍存在且属于该订单用户时回填升级时的地址；无法恢复升级前已修改或已删除的收货信息，缺失信息保留为空。重复迁移不会覆盖已有快照。全新数据库的 `npm run migrate` 已包含这三项增量迁移。回退应用版本时可保留新增字段；旧版应用下单不写地址快照，因此维护窗口中不要混用版本。

个人中心的「收货地址」支持新增、编辑、设为默认和删除，每人最多 20 个。新订单必须选择本人完整地址，下单后更改或删除地址不改变订单的收货信息。原有不完整地址需先编辑补全；旧订单仍可按原状态规则支付、取消和确认收货。

## 5分钟快速启动

### 1. 克隆项目

```bash
git clone <repository-url>
cd E-commerce-website
```

### 2. 一键启动所有服务

```bash
cp .env.example .env
# 编辑根目录 .env，将 openssl rand -hex 32 的结果填入 JWT_SECRET
# 启动所有服务（包括数据库、Redis、后端、前端等）
docker-compose up -d
```

前端 API 地址在构建时写入浏览器代码；修改 `NEXT_PUBLIC_API_URL` 后使用 `docker-compose up -d --build`。

这个命令会自动完成以下操作：
- ✅ 启动MySQL数据库
- ✅ 启动Redis缓存
- ✅ 启动MongoDB数据库
- ✅ 启动RabbitMQ消息队列
- ✅ 启动Elasticsearch搜索引擎
- ✅ 构建并启动后端服务
- ✅ 构建并启动前端应用

### 3. 等待服务启动

```bash
# 查看服务状态（所有服务应该显示为 "Up"）
docker-compose ps

# 查看日志（确保没有错误）
docker-compose logs -f backend
```

等待约1-2分钟，让所有服务完全启动。

### 4. 初始化数据库

```bash
# 运行数据库迁移（创建表结构）
docker-compose exec backend npm run migrate

# 填充示例数据（可选）
docker-compose exec backend npm run seed
```

### 5. 访问应用

打开浏览器，访问：

- **前端应用**: http://localhost:3000
- **后端API**: http://localhost:3001
- **RabbitMQ管理界面**: http://localhost:15672
  - 用户名: `admin`
  - 密码: `admin123`

### 6. 使用测试账号登录

如果您运行了示例数据填充（步骤4），可以使用以下测试账号：

- **邮箱**: test@example.com
- **密码**: 123456

如果没有运行示例数据，请在应用中注册新账号。

## 常用命令

### 查看服务状态
```bash
docker-compose ps
```

### 查看日志
```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 停止服务
```bash
# 停止所有服务
docker-compose stop

# 停止并删除容器
docker-compose down
```

### 重启服务
```bash
# 重启所有服务
docker-compose restart

# 重启特定服务
docker-compose restart backend
```

### 清理数据
```bash
# 停止服务并删除所有数据（包括数据库）
docker-compose down -v

# 警告：这会删除所有数据，请谨慎使用！
```

## 本地开发模式

如果您想在本地开发而不使用Docker，请按以下步骤操作：

### 前置要求
- Node.js 24 LTS（可在根目录执行 `nvm use`）
- MySQL 8.0
- Redis 7
- MongoDB 7

### 后端开发

1. **进入后端目录**
```bash
cd backend
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
# 编辑.env文件，配置数据库连接等信息
```

4. **运行迁移**
```bash
npm run migrate:dev
```

5. **启动开发服务器**
```bash
npm run dev
```

后端将在 http://localhost:3001 运行

### 前端开发

1. **进入前端目录**
```bash
cd frontend
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.local.example .env.local
# 编辑.env.local文件
```

4. **启动开发服务器**
```bash
npm run dev
```

前端将在 http://localhost:3000 运行

## 测试功能

### 1. 浏览商品
- 访问首页查看热门商品和新品推荐
- 点击商品卡片查看详情
- 使用搜索功能查找商品

### 2. 购物流程
1. 注册/登录账号
2. 将商品加入购物车
3. 进入购物车页面
4. 选择商品并结算
5. 创建订单
6. 支付订单（模拟）
7. 查看订单详情

### 3. 管理功能
- 查看我的订单
- 取消待支付订单
- 确认收货

## 故障排查

### 端口被占用

如果遇到端口冲突，编辑 `docker-compose.yml` 修改端口映射：

```yaml
ports:
  - "3001:3001"  # 改为 "3002:3001"
```

### 数据库连接失败

1. 确保MySQL容器正在运行：
```bash
docker-compose ps mysql
```

2. 查看MySQL日志：
```bash
docker-compose logs mysql
```

3. 等待MySQL完全启动（可能需要1-2分钟）

### 前端无法连接后端

1. 确保后端服务正在运行：
```bash
docker-compose logs backend
```

2. 检查环境变量配置：
```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

### 清除并重新开始

如果遇到任何问题，可以完全清除并重新开始：

```bash
# 停止所有服务并删除数据
docker-compose down -v

# 删除Docker镜像（可选）
docker-compose down --rmi all

# 重新启动
docker-compose up -d

# 重新初始化
docker-compose exec backend npm run migrate
docker-compose exec backend npm run seed
```

## 下一步

- 查看 [README.md](README.md) 了解详细的项目文档
- 查看 [DEPLOYMENT.md](DEPLOYMENT.md) 了解部署指南
- 查看 [design_plan.txt](design_plan.txt) 了解系统设计

## 获取帮助

如果您遇到问题：

1. 查看日志：`docker-compose logs -f`
2. 检查服务状态：`docker-compose ps`
3. 查看文档：阅读README和DEPLOYMENT文档
4. 提交Issue：在GitHub仓库提交问题

## 反馈

欢迎提供反馈和建议！如果您在使用过程中遇到任何问题或有改进建议，请提交Issue或Pull Request。

祝您使用愉快！ 🎉
