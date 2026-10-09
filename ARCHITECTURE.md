# 系统架构文档 | System Architecture

本文档描述电商平台当前代码的实际架构。规则和常用命令见 [CLAUDE.md](./CLAUDE.md)，接口细节见 [API.md](./API.md) 和运行时的 `/api-docs`。

**最后更新**: 2026年10月9日

---

## 目录

- [架构概览](#架构概览)
- [技术栈](#技术栈)
- [前端](#前端)
- [后端分层](#后端分层)
- [数据库](#数据库)
- [缓存与限流](#缓存与限流)
- [认证与安全](#认证与安全)
- [订单流程](#订单流程)
- [搜索与推荐](#搜索与推荐)
- [API 约定](#api-约定)
- [部署](#部署)
- [扩展性现状](#扩展性现状)

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│ 浏览器                                                        │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS（会话在 httpOnly Cookie 中）
┌───────────────▼──────────────────────────────────────────────┐
│ 前端 Next.js 16 + React 19（App Router）                       │
│ 商品列表/详情服务端渲染 · 其余页面客户端渲染 · 中英文界面         │
└───────────────┬──────────────────────────────────────────────┘
                │ REST /api（JSON）
┌───────────────▼──────────────────────────────────────────────┐
│ 后端 Express 5（单进程模块化单体）                               │
│ 中间件 → routes → controllers → services / models              │
└──────┬──────────────┬───────────────┬──────────────┬─────────┘
       │              │               │              │
┌──────▼─────┐ ┌──────▼─────┐ ┌───────▼──────┐ ┌─────▼────────┐
│ MySQL 8.0  │ │ Redis 7    │ │ Elasticsearch│ │ RabbitMQ 3   │
│ 必需       │ │ 必需       │ │ 9（可选）    │ │ （可选）     │
│ 数据与事务 │ │ 缓存/限流  │ │ 商品搜索     │ │ 订单超时队列 │
└────────────┘ └────────────┘ └──────────────┘ └──────────────┘
```

### 架构特点

- **前后端分离**：前端 Next.js，后端 Express。Vercel 部署时，后端以函数形式嵌入 Next.js（见[部署](#部署)）。
- **模块化单体**：路由、控制器、服务按业务域拆分，作为一个 Express 应用部署。
- **必需依赖只有 MySQL 和 Redis**：`/health` 仅在两者异常时返回 503。未配置或连不上 Elasticsearch 时，搜索回退到 MySQL。没有 RabbitMQ 时，订单超时由定时任务取消。
- **MySQL 是唯一的事实来源**：价格、库存和上架状态始终从 MySQL 读取，Elasticsearch 只决定匹配哪些商品以及排序。

---

## 技术栈

### 前端（`frontend/package.json`）

| 用途 | 依赖 |
|------|------|
| 框架 | Next.js 16（App Router）、React 19、TypeScript 5 |
| 样式 | Tailwind CSS 4（`@tailwindcss/postcss`） |
| 服务端状态 | TanStack React Query 5 |
| 客户端状态 | Zustand 5（`useAuthStore`、`useCartStore`、`useLocaleStore`） |
| HTTP | Axios |
| UI | React Icons、React Hot Toast、Recharts 3（后台图表） |
| 监控 | `@vercel/analytics`、`@vercel/speed-insights` |
| 测试 | Vitest + Testing Library + happy-dom；Playwright 下单流程（`npm run test:e2e`） |

### 后端（`backend/package.json`）

| 用途 | 依赖 |
|------|------|
| 运行时 | Node.js 24、TypeScript 5.9（不能升到 7，见 CLAUDE.md） |
| Web | Express 5、helmet、cors、compression、express-rate-limit 8 |
| 数据 | mysql2（MySQL 8.0）、ioredis 6（Redis 7，固定 `protocol: 2`） |
| 可选组件 | `@elastic/elasticsearch` 9（只能连 ES 9 服务器）、amqplib（RabbitMQ） |
| 认证 | jsonwebtoken、bcryptjs |
| 邮件 | 找回密码邮件经 Resend API，或 nodemailer 走 Gmail SMTP（`EMAIL_PROVIDER`） |
| 校验 | Joi，以及 `utils/*-validation.ts` 中的 `normalize*` 函数 |
| 日志 | pino（开发环境用 pino-pretty） |
| 文档 | swagger-jsdoc + swagger-ui-express |
| 测试 | Jest + ts-jest + supertest |

---

## 前端

```
frontend/src/
├── app/                      # App Router 页面
│   ├── page.tsx              # 首页
│   ├── products/             # 列表 + [id] 详情（服务端读取，可被搜索引擎收录）
│   ├── cart/  orders/[id]/  coupons/  my/coupons/  favorites/  history/
│   ├── login/  register/  forgot-password/  reset-password/
│   ├── profile/（address/、settings/）
│   ├── help/  shipping/  returns/        # 信息页
│   ├── admin/                # 后台：dashboard、products、orders、after-sales、
│   │                         #       users、coupons、logs、login
│   ├── sitemap.ts  robots.ts
│   └── error.tsx  global-error.tsx  not-found.tsx
├── components/               # 共享组件（Header、ProductDetail、AdminLayout 等）
├── hooks/                    # React Query 封装、会话 hooks
├── lib/
│   ├── api/                  # client.ts（Axios 实例）+ 按领域拆分的接口函数
│   ├── site.ts               # 服务端读取 API（fetchApiResult，带 revalidate）
│   ├── i18n.ts  *-translations.ts  error-translations.ts
│   └── query-client.ts
├── store/                    # Zustand
└── pages/api/[[...path]].ts  # 嵌入式后端入口（仅 Vercel）
```

- **服务端渲染**：商品列表（`revalidate: 60`）、商品详情（默认 300 秒）和 sitemap（3600 秒）在服务端读取 API。容器内通过 `INTERNAL_API_URL` 访问后端。API 不可用时页面照常渲染；已删除或已下架的商品返回真正的 404。
- **客户端数据**：使用 React Query。查询失败不会自动重试，也不会在窗口聚焦时重新请求，页面会显示重试按钮。
- **API 客户端**（`lib/api/client.ts`）：
  - 设置 `withCredentials` 和 `X-Requested-With: XMLHttpRequest`，并删除调用方传入的 `Authorization` 头。
  - 每个请求都记下自己属于哪次登录。迟到的 401 不会登出更新的登录；其他标签页切换账号后，请求会被拒绝并提示刷新。
- **会话状态**：令牌只在 httpOnly Cookie 中，页面脚本读不到。localStorage 只存会话 id 和用户资料，用来在标签页之间同步登录状态。
- **国际化**：界面支持中英文切换。商品带可选的英文内容（`title_en`、`description_en`、`specs_en`），英文界面优先显示英文，缺失时回退原文（`lib/product-content.ts`）；用户和地址等内容保持原文。后端返回中文错误消息，前端用 `error-translations.ts` 翻译成英文。
- **写操作恢复**：下单、加购、领券、新增地址和后台新建商品时，前端先生成一个 UUID 请求键，并把这次操作存进 sessionStorage（`lib/pending-*.ts`，按标签页和登录区分）。网络中断或结果不确定时，用同一个键重试，后端据此返回原来的结果，不会重复创建。

---

## 后端分层

```
backend/src/
├── app.ts            # createApp()：中间件与路由挂载
├── index.ts          # 常驻进程：连接依赖、启动定时任务、监听端口、优雅关闭
├── serverless.ts     # Vercel 函数入口：每次调用确保 MySQL/Redis 已连接
├── load-env.ts       # 必须是上面三个入口文件的第一个 import
├── routes/           # 20 个路由文件，按业务域平铺（admin-*.routes.ts 为后台）
├── controllers/      # 请求校验、调用服务/模型、把领域错误映射为 HTTP 状态码
├── services/         # 跨表业务：order、purchase-items、after-sales、order-timeout、
│                     # message-queue、product-search、recommendation、password-*
├── models/           # 单表/单领域的 SQL 访问
├── middleware/       # auth、admin-auth、rate-limit、request-logger 等
├── database/         # mysql/redis/rabbitmq/elasticsearch 连接、迁移、seed、sync-es
└── utils/            # 校验、金额、会话 Cookie、环境校验、OpenAPI、health
```

### 中间件顺序（`app.ts`）

```
helmet → cors → compression → express.json / urlencoded（上限 1mb）
→ req.body 默认 {} → 响应 Content-Type → /uploads 静态文件 → requestLogger
→ /health、/api/health（独立的内存限流，每分钟 30 次；不经过 Redis）
→ /api-docs、/api/openapi.json
→ /api/internal（在限流之前）
→ /api 通用限流 → 业务路由（各路由自带 authMiddleware / authenticateAdmin / requirePermission）
→ 404 → 错误处理（413 请求体过大、400 JSON 无效，其余 500）
```

### 路由挂载

| 前缀 | 路由文件 |
|------|----------|
| `/api/users` | user（含注册、登录、改密、找回密码） |
| `/api/products` | product |
| `/api/cart` | cart |
| `/api/orders` | after-sales、order |
| `/api/payments` | payment（`GET /settings`：模拟支付是否可用） |
| `/api/addresses`、`/api/reviews`、`/api/favorites` | address、review、favorite |
| `/api/search`、`/api/browse`、`/api/recommendations` | search、browse、recommendation |
| `/api/coupons` | coupon |
| `/api/admin` | admin（登录、登出、仪表盘、日志等） |
| `/api/admin/products`、`/orders`、`/after-sales`、`/users`、`/coupons` | 对应的 admin-*.routes.ts |
| `/api/internal` | internal（`POST /order-timeouts`，凭 `CRON_SECRET` 调用） |

### 错误处理约定

- 输入用 Joi 或 `normalize*` 校验，拒绝未知字段，坏输入返回 400。
- 领域错误使用 `OrderError`（即 `PurchaseError`）、`SKUError`、`AddressError` 等类，`statusCode` 默认 400，控制器用 `res.status(error.statusCode)` 返回。
- 未预期的异常记录到 pino 日志，返回 `500 { error: '服务器内部错误' }`。只有开发环境附带 `message`。

---

## 数据库

MySQL 8.0，共 26 张表。`npm run migrate`（开发用 `migrate:dev`）执行 `database/migrate.ts`：先建基础表，再依次运行 coupon（含 coupon-claims）、sku、address、address-creations、review、account-security、fulfillment、after-sales-progress、order-checkout、product-i18n、product-creations、cart-adds 共 12 个迁移。迁移都可重复执行；部分迁移另有 `npm run schema:*` 只检查不修改。

| 领域 | 表 |
|------|----|
| 用户 | `users`、`shipping_addresses`、`password_reset_tokens` |
| 商品 | `products`、`product_skus`、`categories`、`reviews` |
| 交易 | `cart`、`orders`、`order_items`、`after_sales_requests` |
| 幂等收据 | `address_creation_receipts`、`cart_add_receipts` |
| 优惠券 | `coupons`、`user_coupons`、`coupon_usage_logs` |
| 用户行为 | `favorites`、`search_history`、`browse_history` |
| 后台 | `admins`、`roles`、`permissions`、`role_permissions`、`admin_logs` |
| 统计 | `traffic_statistics`、`page_visits` |

### 关键字段与约束

- `orders.status`：`0` 待支付、`1` 已支付、`2` 已发货、`3` 已完成、`4` 已取消。
- `after_sales_requests.status`：`requested`、`approved`、`rejected`、`withdrawn`。每个订单最多一条售后申请。审核通过不会自动退款。
- `products.status`、`product_skus.status`：`1` 上架/启用，`0` 下架/禁用。
- `users.status`：`1` 启用、`0` 禁用，禁用的账号无法通过认证。
- `users.auth_version`、`admins.auth_version`：会话版本号，见[认证与安全](#认证与安全)。
- 英文内容列：`products.title_en`、`description_en`、`specs_en`，`product_skus.specs_en`，以及下单时快照的 `order_items.product_name_en`、`sku_specs_en`。
- 幂等键：`orders` 的 `(user_id, checkout_key)`、`user_coupons` 的 `claim_key`、`products` 的后台创建键都有唯一约束；新增地址和加购的键与请求内容指纹存在两张收据表中。同一个键带不同内容重试会被拒绝。
- 唯一约束：购物车 `(user_id, product_id, sku_key)`、收藏 `(user_id, product_id)`、评价 `(order_id, product_id)`、`role_permissions (role_id, permission_id)`。
- 全文索引：`products` 的 `FULLTEXT idx_title (title)`，供 MySQL 搜索使用。
- 其余普通索引覆盖常用过滤条件，例如 `orders` 的 user/status/created/order_no、`products` 的 category/price/status、`browse_history (user_id, browsed_at)`。

---

## 缓存与限流

Redis 键统一带前缀 `REDIS_KEY_PREFIX`（默认 `ecommerce:`）。

| 键 | 内容 | TTL | 失效时机 |
|----|------|-----|----------|
| `products:hot:v4` | 热门商品前 100 个 | 600 秒 | 后台改商品或 SKU、评价、下单、取消等改动后删除 |
| `order-timeouts:cursor:v1` | 超时扫描的游标（上次处理到的订单 id） | 86400 秒 | 每批处理后用 Lua 脚本按版本推进 |
| `limits:api:*`、`limits:auth:*`、`limits:password-recovery:*` | 限流计数 | 与限流窗口相同 | 自动过期 |

- 商品详情不再缓存，每次都从 MySQL 读取。失效时仍会删除旧版本留下的键（`product:{id}`、`product:v2:{id}`、`product:v3:{id}` 和更早的 `products:hot*`），键名集中在 `utils/product-cache-keys.ts`。
- 热门商品缓存读写失败只记警告，改从数据库读取。
- 没有会话缓存（会话是无状态 JWT），也没有多级缓存。

### 限流（`middleware/rate-limit.ts`、`password-recovery-limit.ts`）

| 限流器 | 默认值 | 环境变量 |
|--------|--------|----------|
| `apiLimiter`（所有 `/api`，`/api/internal` 除外） | 每个 IP 每 60 秒 100 次 | `RATE_LIMIT_WINDOW`、`RATE_LIMIT_MAX` |
| `authLimiter`（顾客和管理员登录、注册、改密码、重置密码） | 每 60 秒 10 次 | `RATE_LIMIT_AUTH_MAX` |
| `passwordRecoveryLimiter`（申请找回密码） | 每 15 分钟 5 次 | — |
| 健康检查限流（`app.ts`） | 每 60 秒 30 次，始终在内存中 | — |

前三个限流器的计数默认存在进程内存里。在 Vercel 上，或设置了 `RATE_LIMIT_STORE=redis` 时，改存 Redis（`RedisRateLimitStore`），多个实例共享同一份计数。

---

## 认证与安全

### 会话

```
POST /api/users/login            POST /api/admin/login
        │                                │
        ▼                                ▼
JWT { userId, username, email,    JWT { adminId, username, roleId,
      type:'user', authVersion }        type:'admin', authVersion }
有效期 JWT_EXPIRES_IN（默认 7d）    有效期 24h
        │                                │
        ▼                                ▼
Cookie customer_session           Cookie admin_session
（httpOnly、SameSite=Lax、Path=/api、生产环境 Secure）
```

- **密钥**：顾客和管理员共用 `JWT_SECRET`，只通过 `utils/jwt-secret.ts` 的 `jwtSecret()` 读取，令牌身份靠 `type` 字段区分。生产环境缺失或使用弱密钥时，`validateEnv()` 会拒绝启动。
- **令牌来源**：显式的 `Authorization: Bearer` 头优先，供 API 客户端和测试使用；否则读取 Cookie。
- **CSRF**：用 Cookie 认证的写请求必须带 `X-Requested-With`，否则返回 403。`optionalAuth` 遇到这类请求时按匿名处理。登录、登出等会签发或清除 Cookie 的入口还会校验 `Origin`（`hasTrustedSessionSource`）：允许 `CORS_ORIGIN` 中的来源和同源请求，开发环境额外允许本机回环地址。
- **会话撤销**：每个请求都会核对令牌里的 `authVersion` 与数据库中的值，被禁用的顾客账号一律拒绝。顾客改密码或重置密码、管理员登出时，版本号加一，旧令牌立即失效。
- **后台权限**：`authenticateAdmin` 校验管理员令牌和账号状态，`requirePermission(code)` 按 `roles → role_permissions → permissions` 检查权限码，超级管理员不受限制。后台操作写入 `admin_logs`。
- **密码**：bcryptjs，注册用 10 轮，改密码和重置用 12 轮。找回密码使用一次性令牌（`password_reset_tokens`），邮件经 Resend 或 Gmail SMTP 发送，都未配置时该功能关闭。

### 其他措施

- 所有 SQL 都使用参数化查询（mysql2 的 `?` 占位符）。
- `helmet` 设置安全头，Next.js 在 `next.config.js` 中也为所有响应加了基础安全头。
- CORS：`CORS_ORIGIN` 中列出的来源可以带 Cookie。生产环境必须配置它；开发环境未配置时允许任何来源，但不带凭据。
- 请求体上限 1mb。最大的合法请求是批量创建 100 个 SKU，约 350KB。
- 模拟支付只在显式开启的本地和 Preview 环境可用，生产环境禁用。

---

## 订单流程

1. **预览与下单**（`services/order.service.ts`、`purchase-items.service.ts`）：下单必须带 `checkout_key`（UUID），同一个键重试会返回原订单而不是新建一单。金额一律用整数"分"计算（`couponMoneyToCents`、`calculateDiscountCents`）。下单、扣库存和核销优惠券在同一个 MySQL 事务中完成，按固定顺序加 `FOR UPDATE` 行锁：用户 → 地址 → 商品 → SKU → 优惠券。
2. **状态流转**（`transitionOrder`）：支付、发货（承运商和运单号）、确认收货和取消都要先锁订单行；取消时恢复库存。事务提交后删除相关商品的缓存。
3. **超时取消**（创建后 30 分钟未支付）：
   - 配置了 RabbitMQ 时，下单会向 `order.timeout_check.delay` 队列发送一条带 30 分钟 TTL 的消息。消息过期后经死信路由进入 `order.timeout_check`，由消费者检查订单并取消。这种方式不需要延迟插件。
   - 常驻进程还会每 5 分钟扫描一次超时订单（`startOrderTimeoutChecker`），作为兜底。扫描按订单 id 分批进行，每批 50 单，进度记在 Redis 游标里。
   - Serverless 环境没有常驻进程，由外部定时任务调用 `POST /api/internal/order-timeouts`（`CRON_SECRET`）。
4. **售后**：订单可以提交、撤回售后申请，后台审核通过或驳回。

---

## 搜索与推荐

- **搜索**（`services/product-search.service.ts`）：配置了 `ELASTICSEARCH_URL` 时，Elasticsearch 返回匹配的商品 id 和排序，再从 MySQL 读取商品的当前数据。ES 未配置或出错时回退到 MySQL 查询。结果里带 `engine: 'elasticsearch' | 'mysql'`。
- **索引同步**：后台写商品或 SKU 后，`afterProductWrite` 调用 `syncProductsToSearchIndex` 增量同步。`npm run sync-es` 做全量重建。
- **推荐**（`services/recommendation.service.ts`）：全部是 MySQL 查询，包括按浏览历史中的分类推荐、同分类相关商品和热门商品，只返回上架且有库存的商品。
- **用户行为**：搜索历史、浏览历史和收藏分别存在对应的表中。

---

## API 约定

- **路径**：资源前缀见[路由挂载](#路由挂载)，没有 `/api/v1` 这类版本前缀。
- **参数**：路由参数一律是字符串，用 `positiveId()` 或 `req.params.id as string` 解析。
- **成功响应**：直接返回资源对象，没有统一的 `success/data` 外层包装，例如 `{ product }`、`{ products }`、`{ order }`。少数后台接口（如优惠券）另带 `success: true`。
- **分页**：常见格式为 `pagination: { page, limit, total, totalPages }`，后台优惠券接口用的是 `total_pages`。
- **错误响应**：`{ error: '<中文消息>' }`，状态码 400、401、403、404、409、413、503 或 500。
- **文档**：Swagger UI 在 `/api-docs`，JSON 在 `/api/openapi.json`；`npm run build` 会同时生成 OpenAPI 文件。

---

## 部署

### Docker Compose（`docker-compose.yml`）

| 服务 | 镜像 | 端口 |
|------|------|------|
| mysql | mysql:8.0 | `127.0.0.1:3306` |
| redis | redis:7-alpine | `127.0.0.1:6379` |
| rabbitmq | rabbitmq:3-management-alpine | `127.0.0.1:5672`、`127.0.0.1:15672` |
| elasticsearch | elasticsearch:9.5.5 | `127.0.0.1:9200` |
| backend | `backend/Dockerfile` | `3001` |
| frontend | `frontend/Dockerfile` | `3000` |

所有服务都在 `ecommerce-network` 网络中，基础设施端口只绑定本机。启动前必须在根目录 `.env` 中设置 `JWT_SECRET`。

### 本地开发

前后端分别启动：后端 `npm run dev`，端口 3001；前端 `npm run dev`，端口 3000。MySQL 和 Redis 可以用 Compose 启动。

### Vercel

- `frontend/src/pages/api/[[...path]].ts` 在 `ECOMMERCE_SERVERLESS_API=true` 时加载编译好的 `backend/dist/serverless`，同一次部署同时提供前端和 `/api`。
- 函数中没有端口监听、RabbitMQ 消费者或定时器。每次调用确保 MySQL 和 Redis 已连接，连接池上限默认 2（`DB_CONNECTION_LIMIT`）。
- Redis 通常用 Upstash，详见 [docs/VERCEL_UPSTASH.md](./docs/VERCEL_UPSTASH.md)。

### 运维接口

- `GET /health`（也可用 `/api/health`）：返回 MySQL、Redis 以及已配置的 RabbitMQ、Elasticsearch 的状态。只有 MySQL 或 Redis 异常时返回 503。每项检查 3 秒超时，结果缓存 5 秒，响应带 `Cache-Control: no-store`。
- 常驻进程收到退出信号时，先停止接收新连接，再关闭 MySQL、Redis 和 RabbitMQ 连接。

---

## 扩展性现状

当前实现是一个 Express 进程加一个 MySQL 连接池（默认 10 个连接），没有读写分离、分库分表或网关层。下列特性已经可以支持多实例部署：

- 会话是无状态 JWT，放在 Cookie 中，服务器不在内存里保存会话。
- 限流计数可以切换为存 Redis（`RATE_LIMIT_STORE=redis`）。
- 库存和优惠券的并发安全由 MySQL 行锁保证，不依赖进程内的锁。

多实例部署时需要注意：

- 内存限流在每个实例中单独计数，应改为存 Redis。
- 每个常驻实例都会运行 5 分钟一次的超时扫描。取消订单时会锁行并检查状态，所以多个实例重复扫描不会重复取消，但会产生多余的查询。

---

## 相关文档

- [CLAUDE.md](./CLAUDE.md)：开发规则、命令与已知坑
- [API 文档](./API.md)
- [部署文档](./DEPLOYMENT.md)
- [环境配置](./ENV_SETUP.md)
- [Vercel + Upstash](./docs/VERCEL_UPSTASH.md)
- [贡献指南](./CONTRIBUTING.md)
