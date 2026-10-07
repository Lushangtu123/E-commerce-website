# 环境变量配置指南 | Environment Variables Setup Guide

本文档详细说明了项目所需的环境变量配置。

## 📋 目录

- [快速开始](#快速开始)
- [后端环境变量](#后端环境变量)
- [前端环境变量](#前端环境变量)
- [Docker 环境变量](#docker-环境变量)
- [生产环境配置](#生产环境配置)
- [常见问题](#常见问题)

---

## 🚀 快速开始

### 1. 后端配置

```bash
# 进入后端目录
cd backend

# 复制示例文件
cp .env.example .env

# 编辑配置文件
nano .env  # 或使用你喜欢的编辑器
```

### 2. 前端配置

```bash
# 进入前端目录
cd frontend

# 复制示例文件
cp .env.local.example .env.local

# 编辑配置文件
nano .env.local
```

---

## 🔧 后端环境变量

### 必需配置

以下环境变量是必须配置的：

#### 应用基础配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `NODE_ENV` | 运行环境 | `development` | `development` / `production` / `test` |
| `PORT` | 服务端口 | `3001` | `3001` |

#### 数据库配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `DB_HOST` | MySQL 主机地址 | `localhost` | `localhost` / `127.0.0.1` |
| `DB_PORT` | MySQL 端口 | `3306` | `3306` |
| `DB_USER` | 数据库用户名 | `ecommerce` | `ecommerce` |
| `DB_PASSWORD` | 数据库密码 | - | `ecommerce123` |
| `DB_NAME` | 数据库名称 | `ecommerce` | `ecommerce` |

#### Redis 配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `REDIS_HOST` | Redis 主机地址 | `localhost` | `localhost` |
| `REDIS_PORT` | Redis 端口 | `6379` | `6379` |
| `REDIS_PASSWORD` | Redis 密码（可选） | - | `your_redis_password` |

#### JWT 认证配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `JWT_SECRET` | JWT 密钥 | `secret` | `your_super_secret_jwt_key` |
| `JWT_EXPIRES_IN` | JWT 过期时间 | `7d` | `7d` / `24h` / `30m` |

### 可选配置

#### Elasticsearch 配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `ELASTICSEARCH_URL` | Elasticsearch HTTP 地址。不设置时商品搜索使用 MySQL；ES 不可用时自动回退 MySQL。首次启用后运行 `npm run sync-es` 建立索引，之后商品和 SKU 写入会自动同步 | 不启用 | `http://localhost:9200` |

#### RabbitMQ 配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `RABBITMQ_URL` | RabbitMQ 连接 URL，用于下单 30 分钟后精确取消未支付订单。不设置或连接失败不影响启动，超时订单由每 5 分钟一次的定时任务取消 | 不启用 | `amqp://admin:admin123@localhost:5672` |

#### 文件上传配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `UPLOAD_DIR` | 文件上传目录 | `./uploads` | `./uploads` |
| `MAX_FILE_SIZE` | 最大文件大小（字节） | `5242880` | `5242880` (5MB) |

#### 跨域配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `CORS_ORIGIN` | 允许的前端域名，逗号分隔。只有列出的来源能跨域携带登录 Cookie；未配置或 `*` 时放行所有来源但不带 Cookie | 未配置 | `http://localhost:3000` |

#### 限流配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `RATE_LIMIT_MAX` | 时间窗口内最大请求数 | `100` | `100` |
| `RATE_LIMIT_WINDOW` | 限流时间窗口（毫秒） | `60000` | `60000` (1分钟) |

### 配置示例

**开发环境 (backend/.env):**

```bash
NODE_ENV=development
PORT=3001

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=ecommerce
DB_PASSWORD=ecommerce123
DB_NAME=ecommerce

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=dev_jwt_secret_key_for_development_only

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200

# RabbitMQ
RABBITMQ_URL=amqp://admin:admin123@localhost:5672

# CORS
CORS_ORIGIN=http://localhost:3000
```

---

## 🎨 前端环境变量

### 必需配置

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `NEXT_PUBLIC_API_URL` | 后端 API 地址 | - | `http://localhost:3001/api` |

⚠️ **重要提示**: 
- Next.js 中只有以 `NEXT_PUBLIC_` 开头的变量才能在浏览器端访问
- 不要在前端环境变量中存储敏感信息（如密钥、密码等）

### 可选配置

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `NEXT_PUBLIC_SITE_URL` | 网站公开地址，用于 canonical、Open Graph、robots.txt 和 sitemap。生产环境设置后才允许搜索引擎收录；Vercel 生产环境可不填 | `https://your-domain.com` |
| `INTERNAL_API_URL` | 服务端读取商品数据时用的后端地址，前端容器访问不到浏览器用的地址时设置 | `http://backend:3001/api` |
| `ECOMMERCE_SERVERLESS_API` | 把后端内嵌到 Next.js 的 `/api` 路由；Vercel 上自动开启 | `true` |

前端只读取以上变量（加上 Vercel 自动注入的 `VERCEL_*`）；分页大小、功能开关等都写在代码里，不能通过环境变量修改。

### 配置示例

**开发环境 (frontend/.env.local):**

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

---

## 🐳 Docker 环境变量

使用 Docker Compose 时，先复制根目录 `.env.example` 为 `.env`，填写生成的 `JWT_SECRET`，并配置前端域名及 API 地址。Compose 将这些值传入容器；`NEXT_PUBLIC_API_URL` 同时作为前端构建参数传入：

```yaml
services:
  backend:
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_USER=ecommerce
      - DB_PASSWORD=ecommerce123
      - DB_NAME=ecommerce
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - JWT_SECRET=${JWT_SECRET:?Set JWT_SECRET in the root .env}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost:3000}
      - ELASTICSEARCH_URL=http://elasticsearch:9200
      
  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-http://localhost:3001/api}
    environment:
      - NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:3001/api}
```

**注意**: 在 Docker 网络中，服务名可以直接作为主机名使用（如 `mysql`、`redis`、`rabbitmq`）。

---

## 🔒 生产环境配置

### 安全建议

1. **强密码**: 使用强随机密码
2. **JWT 密钥**: 使用加密强度高的随机字符串
3. **环境变量保护**: 不要将 `.env` 文件提交到版本控制
4. **定期更新**: 定期轮换敏感凭证

### 生成安全的 JWT 密钥

```bash
# 使用 Node.js 生成
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 使用 OpenSSL 生成
openssl rand -hex 32

# 使用 Python 生成
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 生产环境示例配置

**后端 (backend/.env):**

```bash
NODE_ENV=production
PORT=3001

# 数据库使用内网地址
DB_HOST=10.0.1.10
DB_PORT=3306
DB_USER=ecommerce_prod
DB_PASSWORD=<strong_random_password>
DB_NAME=ecommerce_prod

# Redis 使用密码保护
REDIS_HOST=10.0.1.11
REDIS_PORT=6379
REDIS_PASSWORD=<strong_redis_password>

# 使用强随机密钥
JWT_SECRET=<generated_strong_secret_key>
JWT_EXPIRES_IN=7d

# 跨域配置为实际域名
CORS_ORIGIN=https://your-domain.com

# 限流设置更严格
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW=60000
```

**前端 (frontend/.env.local):**

```bash
# 生产环境 API 地址
NEXT_PUBLIC_API_URL=https://api.your-domain.com/api

# 网站公开地址（允许搜索引擎收录）
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

---

## ❓ 常见问题

### 1. 环境变量不生效？

**检查清单:**
- [ ] 文件名是否正确（`.env` 或 `.env.local`）
- [ ] 文件是否在正确的目录（backend 或 frontend）
- [ ] 是否重启了服务器
- [ ] Next.js 前端变量是否以 `NEXT_PUBLIC_` 开头
- [ ] 是否有语法错误（如多余的空格、引号）

### 2. 数据库连接失败？

**检查:**
1. 数据库服务是否运行
2. 主机地址、端口是否正确
3. 用户名、密码是否正确
4. 数据库是否已创建
5. 防火墙是否允许连接

### 3. CORS 错误？

**解决方法:**
1. 确保 `CORS_ORIGIN` 包含前端地址
2. 开发环境可以设置为 `*`（不推荐生产环境）。`*` 不允许跨域携带登录 Cookie，前后端端口不同时请明确列出前端地址
3. 检查前端的 `NEXT_PUBLIC_API_URL` 是否正确

### 4. JWT 认证失败？

**检查:**
1. 后端 `JWT_SECRET` 是否稳定，管理员和用户都使用该密钥签名，但使用不同身份令牌；前端不配置密钥
2. Token 是否已过期
3. Token 格式是否正确（`Bearer <token>`）

### 5. Docker 环境变量问题？

**注意:**
1. Docker 中使用服务名作为主机名（如 `mysql` 而不是 `localhost`）
2. 确保 `docker-compose.yml` 中的环境变量正确
3. 使用 `docker-compose config` 检查配置
4. 修改环境变量后需要重新构建：`docker-compose up -d --build`

### 6. 如何查看当前环境变量？

**后端:**
```bash
cd backend
node -e "require('dotenv').config(); console.log(process.env)"
```

**检查特定变量:**
```bash
echo $DB_HOST
echo $NEXT_PUBLIC_API_URL
```

---

## 📝 检查清单

使用此清单确保环境配置正确：

### 后端配置检查

- [ ] 已复制 `.env.example` 为 `.env`
- [ ] MySQL 连接信息正确
- [ ] Redis 连接信息正确
- [ ] JWT_SECRET 已设置（生产环境使用强密钥）
- [ ] 端口未被占用
- [ ] 已运行数据库迁移

### 前端配置检查

- [ ] 已复制 `.env.local.example` 为 `.env.local`
- [ ] NEXT_PUBLIC_API_URL 正确指向后端
- [ ] 所有公开变量都以 NEXT_PUBLIC_ 开头
- [ ] 没有在前端暴露敏感信息

### 测试验证

```bash
# 测试后端连接
curl http://localhost:3001/health

# 测试前端
curl http://localhost:3000

# 测试 API 调用
curl http://localhost:3001/api/products
```

---

## 🔗 相关文档

- [快速启动指南](./QUICK_START_GUIDE.md)
- [部署文档](./DEPLOYMENT.md)
- [Docker 文档](./docker-compose.yml)
- [README](./README.md)

---

**更新日期**: 2025年10月31日  
**版本**: 2.0.0



