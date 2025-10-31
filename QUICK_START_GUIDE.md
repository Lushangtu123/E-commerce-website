# 快速启动指南 | Quick Start Guide

> 📖 **需要详细的环境变量配置？** 请查看 [环境变量配置指南](./ENV_SETUP.md)

## 🚀 启动项目

### 1. 启动 Docker Desktop
确保 Docker Desktop 正在运行（macOS 菜单栏应该能看到 Docker 图标）

### 2. 启动所有服务
```bash
# 在项目根目录
docker-compose up -d
```

这会启动：
- ✅ MySQL 数据库 (端口 3306)
- ✅ Redis 缓存 (端口 6379)
- ✅ MongoDB (端口 27017)
- ✅ RabbitMQ (端口 5672, 管理界面 15672)
- ✅ Elasticsearch (端口 9200)

### 3. 等待服务启动（约30秒）
```bash
# 查看服务状态
docker-compose ps
```

### 4. 运行数据库迁移
```bash
cd backend
npm run migrate:dev
```

### 5. 启动后端服务
```bash
# 在 backend 目录
npm run dev
```

后端将在 http://localhost:3001 运行

### 6. 启动前端服务
```bash
# 新开一个终端，在 frontend 目录
cd frontend
npm run dev
```

前端将在 http://localhost:3000 运行

### 7. 初始化管理员账号（可选）
```bash
# 在项目根目录
./init-admin.sh
```

默认管理员：
- 用户名: admin
- 密码: admin123

---

## 🛑 停止服务

```bash
# 停止所有Docker服务
docker-compose down

# 停止后端/前端（Ctrl+C）
```

---

## 🔍 常见问题

### 问题1: Docker 连接失败
**错误**: `Cannot connect to the Docker daemon`
**解决**: 打开 Docker Desktop 应用

### 问题2: 端口被占用
**错误**: `port is already allocated`
**解决**: 
```bash
# 查看占用端口的进程
lsof -i :3306  # MySQL
lsof -i :3001  # 后端
lsof -i :3000  # 前端

# 停止占用的进程或修改端口
```

### 问题3: 数据库连接失败
**错误**: `ECONNREFUSED 127.0.0.1:3306`
**解决**:
```bash
# 1. 检查 MySQL 容器是否运行
docker-compose ps

# 2. 查看 MySQL 日志
docker-compose logs mysql

# 3. 重启 MySQL
docker-compose restart mysql
```

### 问题4: 已存在的容器冲突
**解决**:
```bash
# 完全清理并重新启动
docker-compose down -v
docker-compose up -d
```

---

## 📊 验证服务状态

### 检查所有Docker服务
```bash
docker-compose ps
```

应该看到所有服务状态为 "Up"

### 检查后端健康
```bash
curl http://localhost:3001/health
```

应该返回: `{"status":"ok","timestamp":"..."}`

### 检查前端
浏览器访问: http://localhost:3000

### 检查管理后台
浏览器访问: http://localhost:3000/admin/login

---

## 🎯 完整启动流程（从零开始）

```bash
# 1. 克隆项目后，安装依赖
cd backend && npm install
cd ../frontend && npm install

# 2. 配置环境变量
cd backend
cp .env.example .env
# 编辑 .env 文件，配置数据库等信息

cd ../frontend
cp .env.local.example .env.local
# 编辑 .env.local 文件

# 3. 启动 Docker Desktop（手动打开应用）

# 4. 启动所有服务
cd ..
docker-compose up -d

# 5. 等待服务就绪
sleep 30

# 6. 运行数据库迁移
cd backend
npm run migrate:dev

# 7. 初始化管理员（可选）
cd ..
./init-admin.sh

# 8. 启动后端
cd backend
npm run dev &

# 9. 启动前端（新终端）
cd frontend
npm run dev
```

> 💡 **提示**: 如果遇到连接问题，请查看 [环境变量配置指南](./ENV_SETUP.md) 确保所有配置正确。

---

## ✅ 成功标志

当看到以下内容时，说明启动成功：

**Docker服务:**
```
NAME                    STATUS
mysql                   Up
redis                   Up
mongodb                 Up
rabbitmq               Up
elasticsearch          Up
```

**后端:**
```
✓ MySQL数据库连接成功
✓ Redis连接成功
✓ MongoDB连接成功
🚀 服务器运行在 http://localhost:3001
```

**前端:**
```
ready - started server on 0.0.0.0:3000
```

现在可以访问 http://localhost:3000 开始使用了！🎉

