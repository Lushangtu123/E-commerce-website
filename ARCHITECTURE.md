# 系统架构文档 | System Architecture

本文档详细描述了电商平台的系统架构设计。

**版本**: 2.0.0  
**最后更新**: 2025年10月31日

---

## 📋 目录

- [架构概览](#架构概览)
- [技术栈](#技术栈)
- [系统分层](#系统分层)
- [数据库设计](#数据库设计)
- [缓存策略](#缓存策略)
- [API 设计](#api-设计)
- [安全架构](#安全架构)
- [部署架构](#部署架构)
- [扩展性设计](#扩展性设计)
- [性能优化](#性能优化)

---

## 🏗️ 架构概览

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户层 (Client)                       │
│                    Web Browser / Mobile                      │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────┐
│                     前端层 (Frontend)                        │
│              Next.js 16 + React 19 + TypeScript              │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 用户界面 │  │ 管理后台 │  │ 状态管理 │  │ 路由管理 │   │
│  │  Pages   │  │  Admin   │  │ Zustand  │  │  Router  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API (JSON)
┌────────────────────────▼────────────────────────────────────┐
│                      API 网关 (Gateway)                      │
│                    Express.js + Middleware                   │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 认证中间 │  │ 限流中间 │  │ 日志中间 │  │ 错误处理 │   │
│  │   件     │  │   件     │  │   件     │  │   中间件 │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   业务逻辑层 (Business)                      │
│                      Controllers + Models                    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 用户服务 │  │ 商品服务 │  │ 订单服务 │  │ 支付服务 │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 购物车   │  │ 评论服务 │  │ 收藏服务 │  │ 搜索服务 │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│  ┌──────────┐  ┌──────────┐                                │
│  │ 浏览历史 │  │ 管理服务 │                                │
│  └──────────┘  └──────────┘                                │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    数据访问层 (Data)                         │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  MySQL   │  │  Redis   │  │ RabbitMQ │  │Elasticsearch│ │
│  │ 关系数据 │  │  缓存    │  │ 延迟队列 │  │  全文搜索  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 架构特点

- **前后端分离**: 前端 Next.js，后端 Express.js
- **微服务化**: 按业务功能模块化设计
- **存储**: MySQL + Redis；Elasticsearch（搜索）和 RabbitMQ（订单超时延迟队列）为可选依赖，不可用时分别回退 MySQL 搜索和定时任务
- **RESTful API**: 标准化的 API 设计
- **容器化部署**: Docker + Docker Compose

---

## 🛠️ 技术栈

### 前端技术栈

```
┌─────────────────────────────────────────┐
│           前端技术栈                     │
├─────────────────────────────────────────┤
│ 框架层                                   │
│  • Next.js 16 (React Framework)         │
│  • React 19 (UI Library)                │
│  • TypeScript 5 (Type System)           │
├─────────────────────────────────────────┤
│ 状态管理                                 │
│  • Zustand 4 (Global State)             │
│  • React Hooks (Local State)            │
├─────────────────────────────────────────┤
│ 样式层                                   │
│  • TailwindCSS 4 (Utility CSS)          │
│  • PostCSS (CSS Processing)             │
├─────────────────────────────────────────┤
│ 数据请求                                 │
│  • Axios (HTTP Client)                  │
│  • SWR (Data Fetching)                  │
├─────────────────────────────────────────┤
│ UI 组件                                  │
│  • React Icons (Icons)                  │
│  • React Hot Toast (Notifications)      │
│  • Recharts (Charts)                    │
│  • Swiper (Carousel)                    │
└─────────────────────────────────────────┘
```

### 后端技术栈

```
┌─────────────────────────────────────────┐
│           后端技术栈                     │
├─────────────────────────────────────────┤
│ 运行时                                   │
│  • Node.js 24+ (Runtime)                │
│  • TypeScript 5 (Language)              │
├─────────────────────────────────────────┤
│ Web 框架                                 │
│  • Express 4 (Web Framework)            │
│  • CORS (Cross-Origin)                  │
│  • Helmet (Security Headers)            │
│  • Compression (Response Compression)   │
├─────────────────────────────────────────┤
│ 数据库                                   │
│  • MySQL 8.0 (Relational DB)            │
│  • mysql2 (MySQL Driver)                │
│  • Redis 7 (Cache & Session)            │
│  • ioredis (Redis Client)               │
├─────────────────────────────────────────┤
│ 认证与安全                               │
│  • JWT (jsonwebtoken)                   │
│  • Bcrypt (Password Hashing)            │
│  • express-rate-limit (Rate Limiting)   │
├─────────────────────────────────────────┤
│ 工具库                                   │
│  • dotenv (Environment Variables)       │
│  • uuid (Unique ID Generation)          │
│  • joi (Validation)                     │
│  • multer (File Upload)                 │
└─────────────────────────────────────────┘
```

---

## 📚 系统分层

### 1. 表现层 (Presentation Layer)

**职责**: 用户界面展示和交互

```typescript
// 组件结构
src/app/
├── page.tsx                 // 首页
├── products/
│   ├── page.tsx            // 商品列表
│   └── [id]/page.tsx       // 商品详情
├── cart/page.tsx           // 购物车
├── orders/page.tsx         // 订单列表
├── admin/                  // 管理后台
│   ├── dashboard/
│   ├── products/
│   ├── orders/
│   └── users/
└── components/             // 共享组件
    ├── Header.tsx
    ├── ProductCard.tsx
    └── AdminLayout.tsx
```

**技术实现**:
- Server-Side Rendering (SSR) 首屏渲染
- Client-Side Rendering (CSR) 交互页面
- 响应式设计，支持多端适配

### 2. API 层 (API Layer)

**职责**: 提供 RESTful API 接口

```typescript
// 路由结构
src/routes/
├── user.routes.ts          // 用户相关
├── product.routes.ts       // 商品相关
├── cart.routes.ts          // 购物车
├── order.routes.ts         // 订单
├── review.routes.ts        // 评论
├── favorite.routes.ts      // 收藏
├── search.routes.ts        // 搜索
├── browse.routes.ts        // 浏览历史
└── admin/                  // 管理员路由
    ├── admin.routes.ts
    ├── admin-product.routes.ts
    ├── admin-order.routes.ts
    └── admin-user.routes.ts
```

**中间件链**:
```
Request → CORS → Helmet → Compression → Rate Limit → Auth → Controller → Response
```

### 3. 业务逻辑层 (Business Logic Layer)

**职责**: 处理业务逻辑和数据验证

```typescript
// 控制器结构
src/controllers/
├── user.controller.ts      // 用户业务逻辑
├── product.controller.ts   // 商品业务逻辑
├── cart.controller.ts      // 购物车业务逻辑
├── order.controller.ts     // 订单业务逻辑
└── ...

// 典型控制器结构
export async function createOrder(req: Request, res: Response) {
  try {
    // 1. 参数验证
    const { address_id, items } = req.body;
    
    // 2. 业务逻辑
    const order = await orderModel.create({...});
    
    // 3. 返回结果
    return res.status(201).json({ order });
  } catch (error) {
    // 4. 错误处理
    return res.status(500).json({ error: error.message });
  }
}
```

### 4. 数据访问层 (Data Access Layer)

**职责**: 数据库操作和数据持久化

```typescript
// 模型结构
src/models/
├── user.model.ts           // 用户数据模型
├── product.model.ts        // 商品数据模型
├── order.model.ts          // 订单数据模型
├── cart.model.ts           // 购物车数据模型
└── ...

// 典型模型方法
export const productModel = {
  // 查询
  findById: async (id: number) => {...},
  findAll: async (filters: any) => {...},
  
  // 创建
  create: async (data: any) => {...},
  
  // 更新
  update: async (id: number, data: any) => {...},
  
  // 删除
  delete: async (id: number) => {...}
};
```

### 5. 数据库层 (Database Layer)

**职责**: 数据存储和管理

```
MySQL (主数据库)
├── users                   // 用户表
├── products                // 商品表
├── product_skus            // SKU表
├── orders                  // 订单表
├── order_items             // 订单详情表
├── cart                    // 购物车表
├── reviews                 // 评论表
├── favorites               // 收藏表
├── search_history          // 搜索历史表
└── ...

Redis (缓存)
├── product:hot             // 热门商品
├── product:{id}            // 商品详情
├── user:session:{id}       // 用户会话
└── ...

```

---

## 🗄️ 数据库设计

### ER 图

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│    Users    │         │  Products   │         │   Orders    │
├─────────────┤         ├─────────────┤         ├─────────────┤
│ id (PK)     │         │ id (PK)     │         │ id (PK)     │
│ username    │         │ name        │         │ order_no    │
│ email       │◄───┐    │ price       │◄───┐    │ user_id (FK)│
│ password    │    │    │ stock       │    │    │ total_amount│
│ phone       │    │    │ category_id │    │    │ status      │
│ created_at  │    │    │ status      │    │    │ created_at  │
└─────────────┘    │    └─────────────┘    │    └─────────────┘
                   │            │           │            │
                   │            │           │            │
                   │    ┌───────▼───────┐   │    ┌───────▼───────┐
                   │    │ Product_SKUs  │   │    │ Order_Items   │
                   │    ├───────────────┤   │    ├───────────────┤
                   │    │ id (PK)       │   │    │ id (PK)       │
                   │    │ product_id(FK)│   │    │ order_id (FK) │
                   │    │ sku_name      │   │    │ product_id(FK)│
                   │    │ price         │   │    │ quantity      │
                   │    │ stock         │   │    │ price         │
                   │    └───────────────┘   │    └───────────────┘
                   │                        │
           ┌───────┴────────┐       ┌──────┴──────┐
           │     Cart       │       │  Favorites  │
           ├────────────────┤       ├─────────────┤
           │ id (PK)        │       │ id (PK)     │
           │ user_id (FK)   │       │ user_id (FK)│
           │ product_id (FK)│       │ product_id  │
           │ sku_id (FK)    │       │ created_at  │
           │ quantity       │       └─────────────┘
           └────────────────┘
```

### 表关系说明

1. **用户 → 订单**: 一对多 (一个用户可以有多个订单)
2. **用户 → 购物车**: 一对多 (一个用户可以有多个购物车项)
3. **用户 → 收藏**: 一对多 (一个用户可以收藏多个商品)
4. **商品 → SKU**: 一对多 (一个商品可以有多个SKU)
5. **订单 → 订单项**: 一对多 (一个订单包含多个商品)
6. **商品 → 评论**: 一对多 (一个商品可以有多个评论)

### 索引策略

```sql
-- 主键索引（自动创建）
PRIMARY KEY (id)

-- 唯一索引
UNIQUE INDEX idx_email ON users(email)
UNIQUE INDEX idx_order_no ON orders(order_no)

-- 普通索引
INDEX idx_user_id ON orders(user_id)
INDEX idx_product_id ON order_items(product_id)
INDEX idx_category_id ON products(category_id)
INDEX idx_status ON orders(status)

-- 复合索引
INDEX idx_user_product ON favorites(user_id, product_id)
INDEX idx_user_status ON orders(user_id, status)

-- 全文索引
FULLTEXT INDEX idx_name ON products(name)
```

---

## 💾 缓存策略

### 缓存架构

```
┌─────────────────────────────────────────────────────────┐
│                    应用层                                │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│                  L1 缓存 (Redis)                         │
│  • 热门商品 (10min TTL)                                  │
│  • 商品详情 (5min TTL)                                   │
│  • 用户会话 (7day TTL)                                   │
│  • 分类数据 (1hour TTL)                                  │
└────────────┬────────────────────────────────────────────┘
             │ Cache Miss
             ▼
┌─────────────────────────────────────────────────────────┐
│                  L2 缓存 (Query Cache)                   │
│  • MySQL Query Cache                                     │
│  • 应用层查询结果缓存                                     │
└────────────┬────────────────────────────────────────────┘
             │ Cache Miss
             ▼
┌─────────────────────────────────────────────────────────┐
│                    数据库 (MySQL)                        │
└─────────────────────────────────────────────────────────┘
```

### 缓存键设计

```typescript
// 缓存键命名规范
const CACHE_KEYS = {
  // 商品相关
  PRODUCT_DETAIL: (id: number) => `product:${id}`,
  PRODUCT_HOT: 'product:hot',
  PRODUCT_LIST: (page: number, limit: number) => `product:list:${page}:${limit}`,
  
  // 用户相关
  USER_SESSION: (userId: number) => `user:session:${userId}`,
  USER_CART: (userId: number) => `user:cart:${userId}`,
  
  // 分类相关
  CATEGORIES: 'categories:all',
  CATEGORY_PRODUCTS: (catId: number) => `category:${catId}:products`
};

// TTL 配置
const CACHE_TTL = {
  PRODUCT_HOT: 600,      // 10分钟
  PRODUCT_DETAIL: 300,   // 5分钟
  CATEGORIES: 3600,      // 1小时
  USER_SESSION: 604800   // 7天
};
```

### 缓存更新策略

```typescript
// 1. Cache Aside (旁路缓存)
async function getProduct(id: number) {
  // 1. 先查缓存
  const cached = await redis.get(CACHE_KEYS.PRODUCT_DETAIL(id));
  if (cached) return JSON.parse(cached);
  
  // 2. 缓存未命中，查数据库
  const product = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  
  // 3. 写入缓存
  await redis.setex(
    CACHE_KEYS.PRODUCT_DETAIL(id),
    CACHE_TTL.PRODUCT_DETAIL,
    JSON.stringify(product)
  );
  
  return product;
}

// 2. Write Through (写穿)
async function updateProduct(id: number, data: any) {
  // 1. 更新数据库
  await db.query('UPDATE products SET ? WHERE id = ?', [data, id]);
  
  // 2. 更新缓存
  const product = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  await redis.setex(
    CACHE_KEYS.PRODUCT_DETAIL(id),
    CACHE_TTL.PRODUCT_DETAIL,
    JSON.stringify(product)
  );
}

// 3. Cache Invalidation (缓存失效)
async function deleteProduct(id: number) {
  // 1. 删除数据库记录
  await db.query('DELETE FROM products WHERE id = ?', [id]);
  
  // 2. 删除缓存
  await redis.del(CACHE_KEYS.PRODUCT_DETAIL(id));
  
  // 3. 清除相关缓存
  await redis.del('product:hot');
  await redis.del('product:list:*');
}
```

---

## 🔌 API 设计

### RESTful 设计原则

```
资源命名:
GET    /api/products          # 获取商品列表
GET    /api/products/:id      # 获取单个商品
POST   /api/products          # 创建商品
PUT    /api/products/:id      # 更新商品
DELETE /api/products/:id      # 删除商品

子资源:
GET    /api/products/:id/skus      # 获取商品的SKU列表
POST   /api/products/:id/skus      # 为商品添加SKU
GET    /api/products/:id/reviews   # 获取商品的评论

操作:
POST   /api/orders/:id/pay         # 支付订单
POST   /api/orders/:id/cancel      # 取消订单
POST   /api/orders/:id/confirm     # 确认收货
```

### 统一响应格式

```typescript
// 成功响应
interface SuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

// 错误响应
interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: any;
}

// 分页响应
interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

### API 版本控制

```
当前版本: v1 (默认)
/api/products          # v1 (默认)
/api/v1/products       # v1 (显式)
/api/v2/products       # v2 (未来版本)
```

---

## 🔒 安全架构

### 认证流程

```
┌──────────┐                                    ┌──────────┐
│  Client  │                                    │  Server  │
└─────┬────┘                                    └────┬─────┘
      │                                              │
      │  1. POST /api/users/login                   │
      │  { email, password }                         │
      ├─────────────────────────────────────────────>│
      │                                              │
      │                           2. 验证用户名密码   │
      │                           3. 生成 JWT Token  │
      │                                              │
      │  4. Response                                 │
      │  { token, user }                             │
      │<─────────────────────────────────────────────┤
      │                                              │
      │  5. 存储 Token (localStorage)                │
      │                                              │
      │  6. GET /api/products                        │
      │  Authorization: Bearer <token>               │
      ├─────────────────────────────────────────────>│
      │                                              │
      │                           7. 验证 Token      │
      │                           8. 提取用户信息     │
      │                           9. 处理请求         │
      │                                              │
      │  10. Response                                │
      │  { products }                                │
      │<─────────────────────────────────────────────┤
```

### JWT Token 结构

```typescript
// Token Payload
interface JWTPayload {
  userId: number;
  email: string;
  role: 'user' | 'admin';
  iat: number;  // issued at
  exp: number;  // expiration
}

// Token 生成
const token = jwt.sign(
  { userId: user.id, email: user.email, role: 'user' },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

// Token 验证
const decoded = jwt.verify(token, process.env.JWT_SECRET);
```

### 安全措施

```typescript
// 1. 密码加密
const hashedPassword = await bcrypt.hash(password, 10);

// 2. SQL 注入防护
const [users] = await pool.execute(
  'SELECT * FROM users WHERE email = ?',
  [email]
);

// 3. XSS 防护
app.use(helmet());

// 4. CORS 配置
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));

// 5. 限流
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// 6. 请求体大小限制
app.use(express.json({ limit: '10mb' }));
```

---

## 🐳 部署架构

### Docker 容器架构

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Network                         │
│                  (ecommerce-network)                     │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Frontend   │  │   Backend    │  │    MySQL     │  │
│  │   (Next.js)  │  │  (Express)   │  │   (8.0)      │  │
│  │   Port 3000  │  │  Port 3001   │  │  Port 3306   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │    Redis     │  │   RabbitMQ   │  │Elasticsearch │  │
│  │    (7.x)     │  │    (3.x)     │  │   (8.11)     │  │
│  │  Port 6379   │  │  Port 5672   │  │  Port 9200   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  ┌──────────────┐                                       │
│  │   RabbitMQ   │                                       │
│  │    (3.x)     │                                       │
│  │  Port 5672   │                                       │
│  │  Port 15672  │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

### 生产环境架构

```
                    ┌──────────────┐
                    │   用户请求    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   CDN/DNS    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Load Balancer│
                    │   (Nginx)    │
                    └──────┬───────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │Frontend │      │Frontend │      │Frontend │
    │Instance1│      │Instance2│      │Instance3│
    └────┬────┘      └────┬────┘      └────┬────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
                    ┌──────▼───────┐
                    │ API Gateway  │
                    └──────┬───────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │Backend  │      │Backend  │      │Backend  │
    │Instance1│      │Instance2│      │Instance3│
    └────┬────┘      └────┬────┘      └────┬────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │ MySQL   │      │  Redis  │      │RabbitMQ │
    │ Master  │      │ Cluster │      │ Cluster │
    └────┬────┘      └─────────┘      │  (opt)  │
         │                             └─────────┘
    ┌────▼────┐
    │ MySQL   │
    │ Slave   │
    └─────────┘
```

---

## 📈 扩展性设计

### 水平扩展

```typescript
// 1. 无状态设计
// ❌ 不要在服务器内存中存储状态
let userSessions = {};  // 错误

// ✅ 使用 Redis 存储状态
await redis.set(`session:${userId}`, JSON.stringify(session));

// 2. 数据库连接池
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  // ...
});

// 3. 负载均衡
// 使用 Nginx 或云服务的负载均衡器
```

### 垂直扩展

```yaml
# Docker Compose 资源限制
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### 数据库扩展

```
读写分离:
┌─────────┐
│ Master  │ ← Write Operations
└────┬────┘
     │ Replication
     ├──────────┬──────────┐
     │          │          │
┌────▼────┐┌───▼────┐┌───▼────┐
│ Slave 1 ││ Slave 2││ Slave 3│ ← Read Operations
└─────────┘└────────┘└────────┘

分库分表:
Users DB
├── users_0 (id % 4 = 0)
├── users_1 (id % 4 = 1)
├── users_2 (id % 4 = 2)
└── users_3 (id % 4 = 3)
```

---

## ⚡ 性能优化

### 前端优化

```typescript
// 1. 代码分割
const AdminDashboard = dynamic(() => import('./admin/dashboard'), {
  loading: () => <Loading />,
  ssr: false
});

// 2. 图片优化
import Image from 'next/image';
<Image
  src="/product.jpg"
  width={300}
  height={300}
  loading="lazy"
  alt="Product"
/>

// 3. 缓存策略
export const revalidate = 60; // ISR: 60秒重新验证
```

### 后端优化

```typescript
// 1. 数据库查询优化
// ❌ N+1 查询问题
for (const order of orders) {
  const items = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
}

// ✅ 使用 JOIN
const orders = await db.query(`
  SELECT o.*, oi.*
  FROM orders o
  LEFT JOIN order_items oi ON o.id = oi.order_id
  WHERE o.user_id = ?
`, [userId]);

// 2. 批量操作
// ❌ 循环插入
for (const item of items) {
  await db.query('INSERT INTO cart ...', [item]);
}

// ✅ 批量插入
await db.query('INSERT INTO cart VALUES ?', [items.map(i => [i.user_id, i.product_id])]);

// 3. 异步处理
// 发送邮件等耗时操作放入队列
await rabbitmq.sendToQueue('email', { type: 'order_confirmation', orderId });
```

### 监控指标

```typescript
// 关键性能指标 (KPI)
const metrics = {
  // 响应时间
  apiResponseTime: '<100ms (P95)',
  pageLoadTime: '<2s',
  
  // 吞吐量
  requestsPerSecond: '1000 RPS',
  
  // 可用性
  uptime: '99.9%',
  
  // 错误率
  errorRate: '<0.1%',
  
  // 缓存命中率
  cacheHitRate: '>80%'
};
```

---

## 📚 相关文档

- [API 文档](./API.md)
- [部署文档](./DEPLOYMENT.md)
- [环境配置](./ENV_SETUP.md)
- [贡献指南](./CONTRIBUTING.md)

---

**维护者**: Full-Stack Development Team  
**最后更新**: 2025年10月31日  
**版本**: 2.0.0


