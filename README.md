# 电商平台系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)

这是一个基于微服务架构的现代化电商平台，采用前后端分离设计，实现了完整的电商核心功能和管理后台。

**📚 English Documentation**: [README_EN.md](./README_EN.md) | **🚀 快速开始**: [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md)

## 🎯 项目亮点

- 🏗️ **微服务架构** - 模块化设计，易于扩展
- 🔐 **完整权限系统** - 用户和管理员双系统
- 💾 **多数据库支持** - MySQL + MongoDB + Redis + Elasticsearch
- 🚀 **高性能优化** - Redis缓存 + 数据库索引优化
- 📱 **响应式设计** - 支持PC、平板、手机多端适配
- 🐳 **容器化部署** - Docker Compose一键部署

## ✨ 功能特性

### 用户功能 (User Features)
- ✅ 用户注册、登录、个人信息管理
- ✅ 商品浏览、搜索、筛选
- ✅ **收藏系统** - 添加/移除收藏，收藏列表管理 🆕
- ✅ **搜索历史** - 自动记录搜索记录，热门搜索排行 🆕
- ✅ **浏览历史** - 自动追踪浏览记录，快速回购 🆕
- ✅ 购物车管理 - 添加/删除/修改商品
- ✅ 订单创建、支付、查看、取消
- ✅ 商品评价与评分

### 商品功能 (Product Features)
- ✅ 商品列表展示（分页、排序）
- ✅ 商品详情查看
- ✅ **商品SKU规格** - 多规格商品支持 🆕
- ✅ 商品分类与筛选
- ✅ 商品搜索（支持Elasticsearch全文搜索）
- ✅ 热门商品推荐
- ✅ 新品推荐

### 订单功能 (Order Features)
- ✅ 订单创建与结算
- ✅ 订单支付（模拟）
- ✅ 订单状态管理（待支付/已支付/已发货/已完成）
- ✅ 订单取消
- ✅ 确认收货
- ✅ 订单详情查看

### 管理后台 (Admin Panel) 🆕
- ✅ **数据统计仪表盘** - 实时销售数据、订单统计
- ✅ **商品管理** - CRUD操作、批量上下架、SKU管理
- ✅ **订单管理** - 订单列表、状态更新、发货操作
- ✅ **用户管理** - 用户列表、消费统计
- ✅ **系统日志** - 管理员操作日志记录
- ✅ **权限控制** - JWT认证、操作权限验证

### 技术特性 (Technical Features)
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

### 核心表（13个表）
| 表名 | 说明 | 状态 |
|------|------|------|
| `users` | 用户表 | ✅ |
| `products` | 商品表 | ✅ |
| `product_skus` | 商品SKU规格表 | 🆕 |
| `categories` | 商品分类表 | ✅ |
| `cart` | 购物车表 | ✅ |
| `orders` | 订单表 | ✅ |
| `order_items` | 订单详情表 | ✅ |
| `shipping_addresses` | 收货地址表 | ✅ |
| `reviews` | 商品评论表 | ✅ |
| `favorites` | 收藏表 | 🆕 |
| `search_history` | 搜索历史表 | 🆕 |
| `browse_history` | 浏览历史表 | 🆕 |
| `admin_logs` | 管理员日志表 | ✅ |

### 数据库特性
- ✅ 规范化设计（第三范式）
- ✅ 合理的索引策略
- ✅ 外键约束
- ✅ JSON字段支持（SKU规格）
- ✅ 时间戳自动更新

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

## 🔌 API接口（65+个）

### 用户相关 (User APIs)
- `POST /api/users/register` - 用户注册
- `POST /api/users/login` - 用户登录
- `GET /api/users/profile` - 获取个人信息
- `PUT /api/users/profile` - 更新个人信息
- `GET /api/users/addresses` - 获取收货地址列表
- `POST /api/users/addresses` - 添加收货地址

### 商品相关 (Product APIs)
- `GET /api/products` - 获取商品列表（支持分页、排序、筛选）
- `GET /api/products/:id` - 获取商品详情（含SKU信息）
- `GET /api/products/hot` - 获取热门商品
- `GET /api/products/categories` - 获取商品分类
- `GET /api/products/search` - 搜索商品

### 收藏相关 (Favorites APIs) 🆕
- `POST /api/favorites` - 添加收藏
- `DELETE /api/favorites/:id` - 取消收藏
- `GET /api/favorites` - 获取收藏列表
- `GET /api/favorites/check/:productId` - 检查是否已收藏

### 搜索相关 (Search APIs) 🆕
- `POST /api/search/history` - 记录搜索历史
- `GET /api/search/history` - 获取搜索历史
- `DELETE /api/search/history/:keyword` - 删除搜索记录
- `GET /api/search/hot` - 获取热门搜索

### 浏览历史 (Browse History APIs) 🆕
- `POST /api/browse` - 记录浏览历史
- `GET /api/browse` - 获取浏览历史
- `DELETE /api/browse/:id` - 删除浏览记录
- `DELETE /api/browse` - 清空浏览历史

### 购物车相关 (Cart APIs)
- `GET /api/cart` - 获取购物车
- `POST /api/cart` - 添加到购物车
- `PUT /api/cart/:id` - 更新购物车商品
- `DELETE /api/cart/:id` - 删除购物车商品
- `POST /api/cart/checkout` - 结算购物车

### 订单相关 (Order APIs)
- `POST /api/orders` - 创建订单
- `GET /api/orders` - 获取订单列表
- `GET /api/orders/:id` - 获取订单详情
- `POST /api/orders/:id/pay` - 支付订单
- `POST /api/orders/:id/cancel` - 取消订单
- `POST /api/orders/:id/confirm` - 确认收货

### 评论相关 (Review APIs)
- `POST /api/reviews` - 创建评论
- `GET /api/reviews/product/:id` - 获取商品评论
- `GET /api/reviews/my` - 获取我的评论

### 管理后台 (Admin APIs) 🆕
**数据统计:**
- `GET /api/admin/dashboard/stats` - 获取统计数据
- `GET /api/admin/dashboard/sales-trend` - 获取销售趋势
- `GET /api/admin/dashboard/top-products` - 获取热门商品

**商品管理:**
- `GET /api/admin/products` - 获取商品列表
- `POST /api/admin/products` - 创建商品
- `PUT /api/admin/products/:id` - 更新商品
- `PUT /api/admin/products/:id/status` - 更新商品状态
- `PUT /api/admin/products/batch/status` - 批量更新状态
- `GET /api/admin/products/:id/skus` - 获取商品SKU
- `POST /api/admin/products/:id/skus` - 创建SKU
- `POST /api/admin/products/:id/skus/batch` - 批量创建SKU

**订单管理:**
- `GET /api/admin/orders` - 获取订单列表
- `PUT /api/admin/orders/:id` - 更新订单状态
- `GET /api/admin/orders/:id` - 获取订单详情

**用户管理:**
- `GET /api/admin/users` - 获取用户列表
- `GET /api/admin/users/:id` - 获取用户详情

**系统日志:**
- `GET /api/admin/logs` - 获取操作日志

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

### 已完成 ✅
- [x] 管理后台系统
- [x] 商品收藏功能
- [x] 商品SKU规格管理
- [x] 搜索历史和热搜
- [x] 浏览历史功能
- [x] 商品编辑功能
- [x] 数据统计仪表盘
- [x] 系统日志记录

### 进行中 🚧
- [ ] 实现Elasticsearch商品搜索
- [ ] 实现RabbitMQ消息队列处理

### 计划中 📋
- [ ] 订单超时自动取消
- [ ] 商品推荐算法
- [ ] 秒杀活动功能
- [ ] 优惠券系统
- [ ] 物流追踪
- [ ] 移动端App
- [ ] 性能进一步优化
- [ ] 单元测试覆盖
- [ ] CI/CD自动化部署

## 📊 项目统计

| 指标 | 数量 |
|------|------|
| 代码行数 | 13,700+ |
| 前端页面 | 20+ |
| API接口 | 65+ |
| 数据库表 | 13 |
| 功能模块 | 13 |
| 提交次数 | 100+ |

## 📚 文档

- [快速启动指南](./QUICK_START_GUIDE.md) - 详细的安装和配置步骤
- [项目描述](./PROJECT_DESCRIPTION.md) - 适合求职简历的项目描述
- [英文文档](./README_EN.md) - English Documentation
- [开发日志](./开发日志_前端.md) - 开发过程记录
- [更新记录](./UPDATE_20251029.md) - 最新更新内容

## 🎨 界面预览

### 用户端界面
- 🏠 首页 - 商品展示、热门推荐
- 🛍️ 商品详情 - SKU选择、收藏、评价
- 🛒 购物车 - 商品管理、结算
- 📦 订单列表 - 订单管理、支付
- ⭐ 收藏列表 - 收藏管理
- 🕐 浏览历史 - 历史记录

### 管理端界面
- 📊 数据仪表盘 - 销售统计、趋势图表
- 📦 商品管理 - CRUD、SKU管理
- 📋 订单管理 - 订单处理、状态更新
- 👥 用户管理 - 用户列表、消费统计

## 🐛 问题排查

如遇到问题，请查看：
1. [开发日志_前端.md](./开发日志_前端.md) - 前端常见问题
2. [开发日志_后端.md](./开发日志_后端.md) - 后端常见问题
3. [开发日志_管理后台.md](./开发日志_管理后台.md) - 管理后台问题

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 提交规范
- `feat:` 新功能
- `fix:` 修复Bug
- `docs:` 文档更新
- `style:` 代码格式
- `refactor:` 代码重构
- `test:` 测试相关
- `chore:` 构建/工具相关

## 📄 许可证

MIT License

## 👥 联系方式

- GitHub: [Lushangtu123](https://github.com/Lushangtu123)
- 项目地址: [E-commerce-website](https://github.com/Lushangtu123/E-commerce-website)

---

## ⚠️ 重要说明

**本项目为学习和演示项目**，包含了电商系统的核心功能实现。

### ✅ 已实现的生产级特性
- JWT身份认证
- 密码加密存储
- SQL注入防护
- XSS防护
- 请求限流
- Redis缓存
- Docker容器化
- 完整的错误处理
- 操作日志记录

### 🚧 生产环境建议补充
- HTTPS证书配置
- 真实支付接口集成
- 短信/邮件服务
- 对象存储（OSS）
- CDN配置
- 监控告警系统
- 备份恢复方案
- 负载均衡配置
- 单元测试和集成测试

---

**最后更新**: 2025年10月29日 | **版本**: 2.0.0

