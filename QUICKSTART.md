# 快速开始指南

本指南将帮助您快速启动和运行电商平台系统。

## 前置要求

请确保您的系统已安装以下软件：

- **Docker Desktop** 20.10+ [下载地址](https://www.docker.com/products/docker-desktop)
- **Docker Compose** 2.0+ (通常包含在Docker Desktop中)
- **Git** (用于克隆项目)

## 5分钟快速启动

### 1. 克隆项目

```bash
git clone <repository-url>
cd E-commerce-website
```

### 2. 一键启动所有服务

```bash
# 启动所有服务（包括数据库、Redis、后端、前端等）
docker-compose up -d
```

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
- Node.js 18+
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
npm run migrate
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

