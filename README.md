# 电商平台系统

这是一个基于微服务架构的现代化电商平台，采用前后端分离设计，实现了完整的电商核心功能。

## ✨ 功能特性

### 用户功能
- ✅ 用户注册、登录、个人信息管理
- ✅ 商品浏览、搜索、筛选
- ✅ 购物车管理
- ✅ 订单创建、支付、查看
- ✅ 商品评价

### 商品功能
- ✅ 商品列表展示
- ✅ 商品详情查看
- ✅ 商品分类
- ✅ 商品搜索（支持全文搜索）
- ✅ 热门商品推荐

### 订单功能
- ✅ 订单创建
- ✅ 订单支付（模拟）
- ✅ 订单状态管理
- ✅ 订单取消
- ✅ 确认收货

### 技术特性
- 🚀 微服务架构
- 💾 Redis缓存优化
- 📊 数据库读写分离设计
- 🔍 Elasticsearch全文搜索
- 📨 RabbitMQ消息队列
- 🐳 Docker容器化部署
- 🔒 JWT身份认证
- 🎨 响应式UI设计

## 🛠️ 技术栈

### 前端
- **框架**: Next.js 14 + React 18
- **语言**: TypeScript
- **样式**: TailwindCSS
- **状态管理**: Zustand
- **HTTP客户端**: Axios
- **UI组件**: React Icons
- **通知**: React Hot Toast

### 后端
- **运行时**: Node.js 18+
- **框架**: Express
- **语言**: TypeScript
- **数据库**: MySQL 8.0
- **缓存**: Redis 7
- **文档数据库**: MongoDB 7
- **搜索引擎**: Elasticsearch 8
- **消息队列**: RabbitMQ 3
- **认证**: JWT

## 📋 系统架构

```
┌─────────────┐
│   前端层    │  Next.js + React
└──────┬──────┘
       │
┌──────▼──────┐
│  API网关    │  Express
└──────┬──────┘
       │
┌──────▼──────────────────────────────┐
│          微服务层                    │
├─────────────────────────────────────┤
│ 用户服务 │ 商品服务 │ 订单服务      │
│ 购物车   │ 评论服务 │ 支付服务      │
└──────┬──────────────────────────────┘
       │
┌──────▼──────────────────────────────┐
│          数据层                      │
├─────────────────────────────────────┤
│ MySQL │ MongoDB │ Redis │ ES        │
└─────────────────────────────────────┘
```

## 📦 数据库设计

### 核心表
- `users` - 用户表
- `products` - 商品表
- `orders` - 订单表
- `order_items` - 订单详情表
- `cart` - 购物车表
- `shipping_addresses` - 收货地址表
- `reviews` - 商品评论表
- `categories` - 商品分类表

## 🚀 快速开始

### 环境要求
- Node.js 18+
- Docker & Docker Compose
- MySQL 8.0+
- Redis 7+
- MongoDB 7+

### 使用Docker Compose（推荐）

1. **克隆项目**
```bash
git clone <repository-url>
cd E-commerce-website
```

2. **启动所有服务**
```bash
docker-compose up -d
```

3. **等待服务启动完成**
```bash
docker-compose ps
```

4. **访问应用**
- 前端: http://localhost:3000
- 后端API: http://localhost:3001
- RabbitMQ管理界面: http://localhost:15672 (admin/admin123)
- Elasticsearch: http://localhost:9200

5. **初始化数据库**
```bash
docker-compose exec backend npm run migrate
```

### 本地开发

#### 后端开发

1. **安装依赖**
```bash
cd backend
npm install
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑.env文件，配置数据库等信息
```

3. **运行数据库迁移**
```bash
npm run migrate
```

4. **启动开发服务器**
```bash
npm run dev
```

后端服务将在 http://localhost:3001 运行

#### 前端开发

1. **安装依赖**
```bash
cd frontend
npm install
```

2. **配置环境变量**
```bash
cp .env.local.example .env.local
# 编辑.env.local文件
```

3. **启动开发服务器**
```bash
npm run dev
```

前端应用将在 http://localhost:3000 运行

## 📁 项目结构

```
E-commerce-website/
├── backend/                 # 后端服务
│   ├── src/
│   │   ├── controllers/    # 控制器层
│   │   ├── models/         # 数据模型层
│   │   ├── routes/         # 路由层
│   │   ├── middleware/     # 中间件
│   │   ├── database/       # 数据库连接
│   │   └── index.ts        # 入口文件
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── app/           # Next.js页面
│   │   ├── components/    # React组件
│   │   ├── lib/           # 工具库
│   │   └── store/         # 状态管理
│   ├── public/            # 静态资源
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── docker-compose.yml      # Docker编排配置
├── design_plan.txt        # 设计文档
└── README.md              # 项目说明
```

## 🔌 API接口

### 用户相关
- `POST /api/users/register` - 用户注册
- `POST /api/users/login` - 用户登录
- `GET /api/users/profile` - 获取个人信息
- `PUT /api/users/profile` - 更新个人信息

### 商品相关
- `GET /api/products` - 获取商品列表
- `GET /api/products/:id` - 获取商品详情
- `GET /api/products/hot` - 获取热门商品

### 购物车相关
- `GET /api/cart` - 获取购物车
- `POST /api/cart` - 添加到购物车
- `PUT /api/cart` - 更新购物车
- `DELETE /api/cart/:id` - 删除购物车商品

### 订单相关
- `POST /api/orders` - 创建订单
- `GET /api/orders` - 获取订单列表
- `GET /api/orders/:id` - 获取订单详情
- `POST /api/orders/:id/pay` - 支付订单
- `POST /api/orders/:id/cancel` - 取消订单
- `POST /api/orders/:id/confirm` - 确认收货

### 评论相关
- `POST /api/reviews` - 创建评论
- `GET /api/reviews/product/:id` - 获取商品评论
- `GET /api/reviews/my` - 获取我的评论

## 🎯 性能优化

### 缓存策略
- ✅ 热门商品信息缓存到Redis（10分钟）
- ✅ 商品详情缓存到Redis（5分钟）
- ✅ 用户Session存储到Redis

### 数据库优化
- ✅ 合理的索引设计
- ✅ 查询优化
- ✅ 连接池管理

### 前端优化
- ✅ 服务端渲染（SSR）
- ✅ 代码分割
- ✅ 图片懒加载
- ✅ CDN静态资源

## 🔐 安全特性

- JWT Token认证
- 密码加密存储（bcrypt）
- SQL注入防护
- XSS防护
- CSRF防护
- 请求限流

## 📊 监控和日志

- 请求日志记录
- 错误日志记录
- 性能监控
- 健康检查接口

## 🧪 测试

```bash
# 后端测试
cd backend
npm test

# 前端测试
cd frontend
npm test
```

## 📝 开发计划

- [ ] 实现Elasticsearch商品搜索
- [ ] 实现RabbitMQ消息队列处理
- [ ] 订单超时自动取消
- [ ] 商品推荐算法
- [ ] 秒杀活动功能
- [ ] 优惠券系统
- [ ] 物流追踪
- [ ] 管理后台
- [ ] 移动端适配
- [ ] 性能优化

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 👥 联系方式

如有问题，请提交 Issue 或联系项目维护者。

---

**注意**: 这是一个演示项目，不建议直接用于生产环境。生产环境需要添加更多的安全措施、错误处理和性能优化。

