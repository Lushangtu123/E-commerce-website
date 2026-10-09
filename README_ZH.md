# 电商平台系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node.js-24_LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

这是一个前后端分离的现代化电商平台，后端为按业务模块划分的 Express 单体应用，实现了完整的电商核心功能和管理后台。

**📚 English Documentation**: [README.md](./README.md) | **🚀 快速开始**: [QUICKSTART.md](./QUICKSTART.md)

## 🎯 项目亮点

- 🏗️ **模块化单体** - 路由、控制器、服务按业务划分，单个 Express 应用部署，也可嵌入 Next.js 部署到 Vercel
- 🔐 **完整权限系统** - 用户和管理员双系统
- 💾 **多存储协同** - MySQL + Redis，可选 Elasticsearch 搜索与 RabbitMQ 延迟队列
- 🚀 **高性能优化** - Redis缓存 + 数据库索引优化
- 📱 **响应式设计** - 支持PC、平板、手机多端适配
- 🐳 **容器化部署** - Docker Compose一键部署

## ✨ 功能特性

### 用户功能 (User Features)

- ✅ **中英文界面** - 商城和管理后台可通过语言菜单切换中文 / English，刷新、跳转及重新登录后保留选择；日期随语言格式化，商品、用户和地址内容保留原文，金额仍使用人民币。
- ✅ 用户注册、登录、个人信息管理
- ✅ 修改密码并撤销旧会话；一次性邮件重置接口（可配置 Gmail SMTP 或 Resend）
- ✅ **个人中心** - 统一管理个人信息、订单、优惠券等 🆕
- ✅ 商品浏览、搜索、筛选
- ✅ **收藏系统** - 添加/移除收藏，收藏列表管理 🆕
- ✅ **搜索历史** - 自动记录搜索记录，热门搜索排行；删除单条历史时保留当前搜索词和页面 🆕
- ✅ **浏览历史** - 自动追踪浏览记录，快速回购 🆕
- ✅ 购物车管理 - 添加/删除/修改商品
- 登录或刷新页面后，页头购物车数量从服务器同步；加载失败可重新读取，添加、改量、删除和结算后跨页面保持一致。
- ✅ **优惠券系统** - 领取优惠券、使用优惠券、优惠计算 🆕
- ✅ 订单创建、支付、查看、取消
- ✅ 商品评价与评分

### 商品功能 (Product Features)
- ✅ 商品列表展示（分页、排序）
- ✅ 仅在原价高于售价时显示促销标记和划线原价，兼容 MySQL 返回的字符串金额
- ✅ 商品详情查看
- ✅ **商品SKU规格** - 多规格商品支持；选择规格后使用该规格的售价与原价，未设置原价的规格不继承商品主价格的折扣。列表、搜索和推荐使用启用规格中的最低售价及同一规格的原价，同价时选择编号最小的规格 🆕
- ✅ 商品分类与筛选
- ✅ 商品搜索（配置 Elasticsearch 时全文搜索，否则或故障时回退 MySQL）
- ✅ 热门商品推荐
- ✅ 新品推荐

### 订单功能 (Order Features)
- ✅ 订单创建与结算
- ✅ 购物车和商品加载失败可明确重试，购买等待最新库存；商品下架造成页数减少时自动回到有效页。
- ✅ 付款按取得订单行锁后的数据库时间检查 30 分钟截止；超时批次报告失败并在 Redis 保存跨实例扫描进度。
- ✅ 订单模拟支付（本地 / Preview 显式启用，明确提示未扣款，生产环境禁用）
- ✅ **订单超时自动取消** - 30分钟未支付自动取消 🆕
- ✅ 订单状态管理（待支付/已支付/已发货/已完成）
- ✅ 订单取消
- ✅ 确认收货
- ✅ 快递公司、运单号与售后申请、撤回及管理员审核（审核不自动退款）
- ✅ 订单详情查看
- ✅ **优惠券在订单中使用** - 结算时可选择优惠券 🆕

### 管理后台 (Admin Panel) 🆕
- ✅ **数据统计仪表盘** - 实时销售数据、订单统计
- 仪表盘营业金额、已支付订单均价和商品销量排名排除演示支付；订单管理统计保留演示单，未记录付款方式的历史订单继续计入营业金额。按日期统计仍使用下单日期。
- ✅ **商品管理** - CRUD操作、批量上下架、SKU管理
- ✅ 规格商品列表展示启用规格的可售库存和最低售价，并单独标注基础值。商品编辑中的基础价格与库存只读，售价和库存通过规格管理调整。
- ✅ **订单管理** - 订单列表、状态更新、发货操作
- 订单管理及用户详情订单列表的商品数量按购买件数汇总，包含同一商品或规格购买多件；历史无商品明细订单显示 0。
- ✅ **用户管理** - 用户列表、消费统计
- ✅ **优惠券管理** - 创建优惠券、管理优惠券状态 🆕
- ✅ **系统日志** - 管理员操作日志记录
- ✅ **权限控制** - JWT认证、操作权限验证

### 技术特性 (Technical Features)
- 🚀 模块化单体架构（Express）
- 💾 Redis缓存优化
- 🔍 Elasticsearch全文搜索（可选，写入自动同步索引，故障回退 MySQL）
- 📨 RabbitMQ延迟队列（可选，订单 30 分钟精确超时；不可用时由定时任务兜底）
- ⏰ **订单超时自动处理** - 基于定时任务的订单状态管理 🆕
- 🎯 **智能推荐系统** - 基于用户行为的商品推荐 🆕
- 🐳 Docker容器化部署
- 🔒 JWT身份认证
- 🎨 响应式UI设计

## 🛠️ 技术栈

### 前端
- **框架**: Next.js 16 + React 19
- **语言**: TypeScript
- **样式**: TailwindCSS
- **状态管理**: Zustand
- **HTTP客户端**: Axios
- **UI组件**: React Icons
- **通知**: React Hot Toast

### 后端
- **运行时**: Node.js 24 LTS
- **框架**: Express
- **语言**: TypeScript
- **数据库**: MySQL 8.0
- **缓存**: Redis 7
- **搜索引擎**: Elasticsearch 9（可选）
- **消息队列**: RabbitMQ 3（可选）
- **认证**: JWT

## 📋 系统架构

```
┌─────────────┐
│   前端层    │  Next.js + React
└──────┬──────┘
       │
┌──────▼──────────────────────────────┐
│   Express 应用（单进程）             │
│   中间件：认证 / 限流 / 日志 / CSRF  │
├─────────────────────────────────────┤
│ 用户 │ 商品 │ 购物车 │ 订单 │ 售后  │
│ 评价 │ 优惠券 │ 搜索 │ 推荐 │ 管理  │
└──────┬──────────────────────────────┘
       │
┌──────▼──────────────────────────────┐
│          数据层                      │
├─────────────────────────────────────┤
│ MySQL │ Redis │ ES（可选）│ MQ（可选）│
└─────────────────────────────────────┘
```

## 📦 数据库设计

### 数据表（26 个）
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
| `coupons` | 优惠券表 | 🆕 |
| `user_coupons` | 用户优惠券领取记录表 | 🆕 |
| `coupon_usage_logs` | 优惠券使用日志表 | 🆕 |
| `admins` | 管理员表 | ✅ |
| `admin_logs` | 管理员日志表 | ✅ |
| `roles` | 管理员角色表 | ✅ |
| `permissions` | 权限表 | ✅ |
| `role_permissions` | 角色权限关联表 | ✅ |
| `traffic_statistics` | 流量统计表 | ✅ |
| `page_visits` | 页面访问记录表 | ✅ |
| `password_reset_tokens` | 一次性密码重置凭据表 | ✅ |
| `after_sales_requests` | 售后申请表 | ✅ |
| `address_creation_receipts` | 新增地址幂等收据表 | ✅ |
| `cart_add_receipts` | 加购幂等收据表 | ✅ |

### 数据库特性
- ✅ 规范化设计（第三范式）
- ✅ 合理的索引策略
- ✅ 外键约束
- ✅ JSON字段支持（SKU规格）
- ✅ 时间戳自动更新

## 🚀 快速开始

### 环境要求
- Node.js 24 LTS（项目根目录提供 `.nvmrc`）
- Docker & Docker Compose
- MySQL 8.0+
- Redis 7+
- 可选：Elasticsearch 9、RabbitMQ 3

### 使用Docker Compose（推荐）

1. **克隆项目**
```bash
git clone <repository-url>
cd E-commerce-website
```

2. **配置并启动所有服务**
```bash
cp .env.example .env
# 编辑根目录 .env：JWT_SECRET 填 openssl rand -hex 32 的结果，
# MYSQL_ROOT_PASSWORD、MYSQL_PASSWORD、RABBITMQ_PASSWORD 各填一个 openssl rand -hex 16 的结果
docker-compose up -d
```

部署到其他域名时，同时设置 `CORS_ORIGIN` 和 `NEXT_PUBLIC_API_URL`，然后重新构建前端。

3. **等待服务启动完成**
```bash
docker-compose ps
```

4. **访问应用**
- 前端: http://localhost:3000
- 后端API: http://localhost:3001
- RabbitMQ管理界面: http://localhost:15672（用户 admin，密码为 .env 中的 RABBITMQ_PASSWORD）

数据库、Redis、RabbitMQ、Elasticsearch 的端口只绑定在本机 127.0.0.1，局域网无法访问。
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
npm run migrate:dev
```

已有数据库可在 `backend` 目录执行 `npm run migrate-review:dev` 单独升级评价约束；生产环境先 `npm run build`，再 `npm run migrate-review`。迁移可重复运行，为 `(order_id, product_id)` 增加唯一约束并限制评分为 1–5。请先备份数据库；遇到历史重复评价、非法评分或同名约束定义不一致时，迁移会报错停止，保留记录，人工核对修复后再重试。完整基础迁移也包含此步骤。

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
├── scripts/               # 开发辅助脚本（dev/）和手工接口测试（manual-tests/）
├── docs/                  # 文档（设计稿在 docs/archive/design_plan.txt）
├── README.md              # 项目说明（英文）
└── README_ZH.md           # 项目说明（中文）
```

## 🔌 API接口（100+ 个）

### 用户相关 (User APIs)
- `POST /api/users/register` - 用户注册
- `POST /api/users/login` - 用户登录
- `GET /api/users/profile` - 获取个人信息
- `GET /api/users/stats` - 获取本人订单总数、待支付订单数、已领券总数、当前有效可用券数和收藏数
- `PUT /api/users/profile` - 更新个人信息
- `PUT /api/users/password` - 验证当前密码并修改密码，撤销所有旧用户会话
- `GET /api/users/password/capabilities` - 获取找回功能可用状态
- `POST /api/users/password/forgot` - 请求重置邮件；服务未配置时安全禁用
- `POST /api/users/password/reset` - 使用 30 分钟内的一次性凭据重置密码
- `POST /api/users/logout` - 退出登录（清除会话 Cookie）

密码找回支持两种后端邮件服务。Gmail 配置 `EMAIL_PROVIDER=gmail`、`GMAIL_USER`、`GMAIL_APP_PASSWORD` 和 `APP_URL`；Resend 配置 `RESEND_API_KEY`、`EMAIL_FROM` 和 `APP_URL`（未设置 `EMAIL_PROVIDER` 时的默认服务）。只有商城的 Gmail 发件账户需要应用专用密码；收件人使用已注册的账户邮箱，无需 Gmail 账户或应用专用密码。凭据仅保存于后端环境配置，不能放入前端变量或 Git；配置缺失或无效时关闭找回功能。配置和收信验证方法见 [邮件部署指引](./docs/VERCEL_UPSTASH.md)。

注册仅接受用户名、邮箱和密码：用户名去除首尾空白后为 1–50 个字符，邮箱为合法地址且最多 100 个字符，密码至少 12 个字符、最多 72 个 UTF-8 字节，不能全部为空白，保留密码空白。注册成功返回 `201`，用户名或邮箱冲突返回 `409`，包含并发注册冲突。登录保留已有账户的密码长度兼容性。

登录或注册期间浏览器存储失败时，页面提示错误并尝试清理服务器 Cookie；清理标记阻止刷新后恢复未完整保存的身份。恢复浏览器存储后需手动重新登录，注册账号可能已经创建成功。

个人资料更新仅接受 `username`、`phone`、`avatar_url`，至少提供一项；手机号最多 20 个字符，头像为最多 255 个字符的 HTTP(S) 网址，两者可用空字符串或 `null` 清空。更新已有值也返回成功；公开资料不包含密码哈希，错误提示支持中英文。

个人中心的「编辑资料」入口打开 `/profile/settings`，从服务器加载最新资料，可修改用户名、联系电话和头像地址，邮箱只读。保存后同步个人中心和浏览器缓存，刷新后保留修改；手机号和头像留空即可清除。加载失败可重试，保存失败保留草稿，保存期间防止重复提交；中英文切换即时生效，切换账户或离开页面后旧请求不能覆盖当前资料。个人中心显示已保存的头像，图片加载失败时显示默认图标。

### 收货地址 (Address APIs)
- `GET /api/addresses` - 获取本人收货地址，默认地址优先
- `POST /api/addresses` - 添加完整地址，首个自动设为默认，每人最多 20 个
- `PUT /api/addresses/:id` - 编辑完整地址，`is_default: true` 可设为默认
- `PUT /api/addresses/:id/default` - 仅接受空对象，将本人地址设为默认；保留其他标签页刚保存的收件信息，并与地址编辑串行处理
- `DELETE /api/addresses/:id` - 删除本人地址，删除默认地址后自动选择另一地址

完整地址包含 `receiver_name`、`phone`、`province`、`city`、`district`、`detail_address` 六个非空字符串，可选 `is_default` 布尔值；不能指定其他用户。前端个人中心的「收货地址」可管理地址，购物车结算必须选择地址。

### 商品相关 (Product APIs)
- `GET /api/products` - 获取商品列表（支持分页、排序、筛选）
- `GET /api/products/:id` - 获取商品详情（含SKU信息）
- `GET /api/products/hot` - 获取热门商品
- `GET /api/products/categories` - 获取商品分类
- `POST /api/products`、`PUT /api/products/:id` - 创建、更新商品（需管理员 `product:create` / `product:edit` 权限）

关键词搜索使用 `GET /api/products?keyword=...`（MySQL）或 `GET /api/search/es`（Elasticsearch，可回退 MySQL）。
MySQL 搜索按空白拆词，每个词都须出现在品牌、标题或描述（含英文翻译）中，各词可匹配不同字段。例如 `Acme headphones` 可找到品牌为 Acme、英文标题含 headphones 的商品。`%` 和 `_` 按字面字符搜索；匹配结果继续支持现有筛选、排序和分页。

### 收藏相关 (Favorites APIs) 🆕
- `POST /api/favorites` - 添加收藏，body 为 `{ product_id }`，商品必须存在且上架
- `POST /api/favorites/toggle` - 切换本人收藏状态，body 同上
- `DELETE /api/favorites/:product_id` - 取消收藏，按商品 ID 删除
- `GET /api/favorites/my` - 分页获取本人收藏列表
- `GET /api/favorites/count` - 获取本人收藏总数
- `GET /api/favorites/check/:product_id` - 检查是否已收藏
- `POST /api/favorites/check-multiple` - 批量检查，body 为 `{ product_ids }`（1–100 个正整数）

### 搜索相关 (Search APIs) 🆕
- `GET /api/search/es` - 商品搜索：配置 Elasticsearch 时全文搜索，否则回退 MySQL（公开，登录用户记入本人搜索历史）
- `GET /api/search/hot` - 获取热门搜索
- `GET /api/search/suggestions` - 根据搜索历史给出搜索建议
- `POST /api/search/record` - 记录搜索历史
- `GET /api/search/history` - 获取本人搜索历史（需登录）
- `DELETE /api/search/history` - 清空本人搜索历史（需登录）
- `DELETE /api/search/history/:keyword` - 删除一条搜索记录（需登录）

### 浏览历史 (Browse History APIs) 🆕
- `POST /api/browse/record` - 记录浏览，body 为 `{ product_id }`，商品必须存在且上架
- `GET /api/browse/history` - 按商品去重，分页返回本人最新浏览时间对应的记录
- `DELETE /api/browse/history/:product_id` - 删除本人该商品的全部浏览记录
- `DELETE /api/browse/history` - 清空本人浏览历史

收藏和浏览历史分页默认 `page=1&limit=20`，`limit` 最多 100；查询仅接受规范的正整数字符串，不接受重复、未知或非法参数。商品 ID 支持 JavaScript 安全正整数。已失效的商品记录仍可删除，缺失商品显示「商品已不存在」。两页加载失败可重试，切换账号立即隐藏旧数据；删除最后一页的唯一记录后自动返回有效页。

删除结果未知或记录已被移除时，页面重新读取列表。若读取失败，「重新核对列表」仅重试读取，并在核对完成前锁定其他操作，不会重复删除。

### 购物车相关 (Cart APIs)
- `GET /api/cart` - 获取购物车，包含规格快照信息及 available/unavailable_reason
- `POST /api/cart` - 添加商品，body 为 `{ product_id, quantity, sku_id? }`
- `PUT /api/cart` - 更新数量，body 同上；quantity 为 0 时移除该规格
- `DELETE /api/cart/:id?sku_id=规格ID` - 删除指定规格；省略 sku_id 只删除无规格行
- `DELETE /api/cart` - 清空当前用户购物车

### 订单相关 (Order APIs)
- `POST /api/orders/preview` - items 为 `{ product_id, quantity, sku_id? }[]`，按服务器商品/规格价格预览金额与可用优惠券（只读）
- `POST /api/orders` - 创建订单，必填本人有效的 `shipping_address_id`，可携带 `user_coupon_id`，返回原价、优惠额和应付金额；收货信息由服务器保存快照，后续编辑或删除地址不改变订单
- `GET /api/orders` - 获取本人订单列表；`page` 默认 1，`limit` 默认 10（最多 100），`status` 可选 0–4；返回 `orders`、`total`、`page`、`limit`、`totalPages`
- `GET /api/orders/:id` - 获取订单详情
- `GET /api/orders/:id/remaining-time` - 距自动取消还剩的支付时间（分钟）
- `GET /api/payments/settings` - 查看是否允许演示支付
- `POST /api/orders/:id/pay` - 演示支付，不实际扣款；禁用时返回 503
- `POST /api/orders/:id/cancel` - 取消订单

个人中心显示服务器统计，加载失败可重试；「待支付」入口直接筛选未付款订单。可用券数量排除已使用、过期、未生效、停用及规则无效的券，满减门槛由具体订单结算时校验。订单状态筛选保存在地址栏，刷新、前进后退均恢复对应筛选，顶部订单入口恢复全部订单，切换状态回到第一页。订单列表支持全部五种状态和前后翻页，按创建时间及订单 ID 倒序排列；支付或取消导致当前筛选页为空时自动回到有效页。
- `POST /api/orders/:id/confirm` - 确认收货
- `GET /api/orders/:id/after-sales`、`POST /api/orders/:id/after-sales` - 查看、提交本人的售后申请
- `POST /api/orders/:id/after-sales/withdraw` - 撤回待审核申请
- `GET /api/admin/after-sales`、`POST /api/admin/after-sales/:id/review` - 管理员查看及审核；每个订单最多申请一次，不自动退款或恢复库存

### 评论相关 (Review APIs)
- `POST /api/reviews` - 创建评论
- `GET /api/reviews/product/:id` - 获取商品评论
- `GET /api/reviews/my` - 获取我的评论，可用 `order_id` 筛选本人指定订单，保留 `page`、`limit` 分页

仅允许评价本人已完成订单里购买的商品；每个订单的每种商品只能评价一次，并发重复提交返回 `409`。评分必须为整数 1–5，文字可选、最多 2000 个字符，图片可选、最多 9 个 HTTP(S) 地址（每个最多 2048 个字符）。创建成功返回 `201`；列表默认 `page=1&limit=10`，每页最多 100 条，按创建时间和评价 ID 倒序排列，拒绝未知字段及不合法的 ID、分页参数。

已完成订单的详情页提供「订单评价」：同一商品的多个 SKU 共用一次评价，可选择 1–5 分并填写可选文字。进入时加载当前订单全部评价页，已评价商品显示原内容；保存期间禁止重复提交，失败保留草稿，遇到并发重复评价会重新加载服务器记录。界面和系统提示支持中英文，切换账号、登录会话或订单后忽略旧请求。图片地址仍可通过 API 提交，当前界面提供评分与文字。

### 优惠券相关 (Coupon APIs) 🆕
**用户端:**
- `GET /api/coupons/available` - 获取可领取优惠券列表
- `POST /api/coupons/receive` - 领取优惠券
- `GET /api/coupons/my/list` - 获取我的优惠券列表
- `GET /api/coupons/my/available-for-order` - 获取订单可用优惠券
- `POST /api/coupons/calculate` - 计算优惠金额
- `GET /api/coupons/:id` - 获取优惠券详情

**管理员端:**
- `POST /api/admin/coupons` - 创建优惠券
- `GET /api/admin/coupons` - 获取优惠券列表
- `GET /api/admin/coupons/:id` - 获取优惠券详情
- `PUT /api/admin/coupons/:id/status` - 更新优惠券状态

### 推荐相关 (Recommendation APIs) 🆕
- `GET /api/recommendations/personalized` - 基于浏览历史的个性化推荐（需登录）
- `GET /api/recommendations/guess-you-like` - 猜你喜欢（登录时个性化，否则为热门商品）
- `GET /api/recommendations/related/:productId` - 获取相关商品推荐

### 管理后台 (Admin APIs) 🆕
**会话:**
- `POST /api/admin/login` - 管理员登录
- `POST /api/admin/logout` - 退出登录，并使该管理员的所有会话失效
- `GET /api/admin/profile` - 管理员信息及权限

**数据统计:**
- `GET /api/admin/dashboard/stats` - 获取统计数据
- `GET /api/admin/dashboard/sales-trend` - 获取销售趋势
- `GET /api/admin/dashboard/top-products` - 获取热门商品
- `GET /api/admin/dashboard/recent-orders` - 最新订单

**商品管理:**
- `GET /api/admin/products` - 获取商品列表
- `POST /api/admin/products` - 创建商品
- `PUT /api/admin/products/:id` - 更新商品
- `PUT /api/admin/products/:id/status` - 更新商品状态
- `PUT /api/admin/products/batch/status` - 批量更新状态
- `DELETE /api/admin/products/:id` - 删除商品（软删除：保留记录，状态置为 -1）
- `GET /api/admin/products/:id/skus` - 获取全部启用/停用 SKU，返回 `{ product: { product_id, title, status }, skus }`
- `POST /api/admin/products/:id/skus` - 创建SKU
- `POST /api/admin/products/:id/skus/batch` - 批量创建SKU
- `PUT /api/admin/products/skus/:skuId` - 更新SKU
- `PUT /api/admin/products/:id/skus/:skuId` - 更新指定商品的 SKU，校验所属商品；需要 `product:edit` 权限
- `DELETE /api/admin/products/skus/:skuId` - 停用SKU，保留历史库存及订单关联

**订单管理:**
- `GET /api/admin/orders` - 获取订单列表
- `GET /api/admin/orders/:id` - 获取订单详情
- `PUT /api/admin/orders/:id/status` - 更新订单状态（发货需填写快递公司和运单号）

管理员状态变更与对应审计记录在同一事务中提交。审计写入失败会回滚状态及相关库存、销量和优惠券变更；写入前按审计字段长度限制请求 IP 和 User-Agent。

商品、SKU、优惠券及用户状态写入也与审计记录使用同一 MySQL 事务；审计失败会回滚业务修改，包括用户会话撤销。带请求号的商品新增重试只返回原回执，不重复写审计；商品缓存和搜索刷新在提交后执行。
- `GET /api/admin/orders/stats/overview` - 订单统计

**用户管理:**
- `GET /api/admin/users` - 获取用户列表
- `GET /api/admin/users/:id` - 获取用户详情
- `GET /api/admin/users/:id/orders` - 获取用户订单
- `PUT /api/admin/users/:id/status` - 启用或禁用用户
- `GET /api/admin/users/stats/overview` - 用户统计

**系统日志:**
- `GET /api/admin/logs` - 获取操作日志

### 运维 (Operations)
- `GET /health`、`GET /api/health` - 健康检查；仅 MySQL 或 Redis 异常时返回 503（RabbitMQ、Elasticsearch 作为可选依赖单独标记）
- `POST /api/internal/order-timeouts` - 供外部定时任务取消超时订单，需 `Authorization: Bearer <CRON_SECRET>`

## 🎯 性能优化

### 缓存策略
- ✅ 热门商品信息缓存到Redis（10分钟）
- ✅ 商品详情缓存到Redis（5分钟）
- ✅ 设置 `RATE_LIMIT_STORE=redis` 或部署在 Vercel 时，限流计数存储在 Redis（登录会话是 httpOnly Cookie 中的签名 JWT，不存储在 Redis）

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

# 前端测试（Vitest + React Testing Library + happy-dom）
cd frontend
npm test
npm run test:watch    # 监听模式

# 搜索、管理员会话与列表回归（在 frontend 目录运行）
npx vitest run tests/search-pages.test.tsx tests/admin-session.test.tsx tests/admin-lists.test.tsx
```

前端测试使用 Vitest + React Testing Library + happy-dom。测试写成 `tests/*.test.ts(x)`，渲染真实组件，并参与 `npm run typecheck` 类型检查；共享的初始化（清空 localStorage、重置 URL 和 Zustand store）在 `tests/setup.ts`，等待异步结果、模拟重复点击、检查第一次渲染等工具在 `tests/helpers.tsx`。

完整浏览器交易回归使用真实本机 MySQL 测试库，覆盖注册、地址、演示支付、发货、收货、售后审核及修改密码。运行方式及新数据库迁移见 [Vercel / Upstash 部署文档](./docs/VERCEL_UPSTASH.md)。

商品搜索、历史记录和搜索建议统一修剪关键词并限制为 100 个字符；历史、热搜和建议的数量限制为 1–100，热搜统计天数为 1–365。非法类型、范围和未知字段在查询前返回 400。搜索历史在登录状态恢复后加载，并在切换账户时清空；迟到请求不能写入其他账户。商品搜索更换关键词或排序后回到第一页，加载失败可重试。

客户和后台的订单路径编号统一使用规范正十进制整数，最大为 9007199254740991；科学计数、数字前缀、符号、前导零和不安全整数在访问订单数据前返回 400。

订单详情遇到网络或临时服务错误时保留当前页面并提供重试；状态刷新失败时保留已加载详情，重新加载前禁用支付、取消和收货。不存在或无权限的订单显示对应错误；迟到的重试结果不能影响其他账户或订单。

后台商品、用户和日志列表统一使用 API 客户端处理登录失效，迟到响应不能覆盖当前身份或查询。商品批量选择仅作用于当前页，翻页或筛选后清空；商品与用户写操作在请求完成前禁止重复提交。

商品列表的「管理规格」进入 `/admin/products/:id/skus`，可新增、编辑、启用和停用 SKU，并显示启用规格的库存总和及最低售价。规格属性使用名称/值表单，最多20项且名称不可重复；仅改价或库存时保留既有数字、布尔属性类型。编码为1–50个字符，以字母或数字开头，可含点、下划线和连字符；金额为0–99999999.99，最多两位小数；库存为0–2147483647的整数；原价和图片地址留空会清除。新增首个 SKU 后购买使用规格价格和库存，全部停用后无法购买；停用保留库存和订单关联。操作记录审计日志并清除商品缓存，失败保留输入，保存成功但刷新失败时只重载列表，避免重复新增。页面和系统提示支持中英文，账号、登录会话或商品切换后忽略旧请求。

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
- [x] 订单超时自动取消
- [x] 商品推荐算法
- [x] **优惠券系统** - 完整的优惠券功能 🆕
- [x] **个人中心页面** - 统一的用户功能入口 🆕

### 最近完成 🎉
- [x] Elasticsearch 商品搜索：写入同步索引、MySQL 回退、参数校验（可选依赖）
- [x] RabbitMQ 订单超时延迟队列改为可选依赖，断线重连后恢复消费；移除未使用的 MongoDB
- [x] 优惠券结算：服务器预览、事务占用、取消返券与订单金额快照（2026-10-02）
- [x] **优惠券系统** (2025-11-03)
  - 用户端：优惠券中心、我的优惠券、优惠券使用
  - 管理端：优惠券创建、状态管理
  - 3种优惠券类型：满减券、折扣券、无门槛券
- [x] **个人中心页面** (2025-11-03)
  - 用户信息展示
  - 优惠券专区（醒目设计）
  - 功能菜单网格（6个快捷入口）
- [x] **字符编码优化** (2025-11-03)
  - 完整的 UTF-8 编码链路
  - 修复中文显示乱码问题
- [x] 订单超时自动取消 (2025-10-31)
- [x] 商品推荐算法 (2025-10-31)

### 计划中 📋
- [ ] 秒杀活动功能
- [ ] 物流追踪
- [ ] 移动端App
- [ ] 性能进一步优化

## 📊 项目统计

| 指标 | 数量 |
|------|------|
| 代码行数（不含测试） | 27,000+ |
| 前端页面 | 30 |
| API接口 | 100+ |
| 数据库表 | 26 |
| 功能模块 | 15 |
| 提交次数 | 390+ |
| 开发文档 | 7,000+ 行 |

## 📚 文档

### 核心文档
- [快速启动指南](./QUICKSTART.md) - 详细的安装和配置步骤
- [环境变量配置](./ENV_SETUP.md) - 环境变量配置详细指南 🆕
- [API 接口文档](./API.md) - 完整的 API 接口说明和示例 🆕
- [系统架构文档](./ARCHITECTURE.md) - 系统架构设计和技术选型 🆕
- [安全策略](./SECURITY.md) - 安全特性和漏洞报告流程 🆕
- [贡献指南](./CONTRIBUTING.md) - 代码规范和贡献流程 🆕

### 功能文档 🆕
- [优惠券前端使用指南](./docs/guides/COUPON_FRONTEND_GUIDE.md) - 优惠券功能详细说明
- [个人中心页面指南](./docs/guides/PROFILE_PAGE_GUIDE.md) - 个人中心功能和设计
- [管理后台文档](./docs/guides/ADMIN_GUIDE.md) - 管理后台使用说明

### 开发文档
- [前端开发日志](./docs/archive/开发日志_前端.md) - 前端开发过程记录（3,100+ 行）
- [后端开发日志](./docs/archive/开发日志_后端.md) - 后端开发过程记录（3,900+ 行）
- [管理后台开发记录](./docs/archive/开发日志_管理后台.md) - 管理后台开发记录

### 其他文档
- [项目描述](./docs/archive/PROJECT_DESCRIPTION.md) - 适合求职简历的项目描述
- [英文文档](./README.md) - English Documentation
- [更新记录](./docs/archive/UPDATE_20251029.md) - 历史更新内容
- [历史文档归档](./docs/archive/README.md) - 开发过程中的更新总结、测试报告等历史文档索引

## 🎨 界面预览

### 用户端界面
- 🏠 首页 - 商品展示、热门推荐、**优惠券横幅** 🆕
- 👤 **个人中心** - 统一管理个人信息、订单、优惠券 🆕
- 🎁 **优惠券中心** - 领取优惠券、查看可用优惠 🆕
- 🎫 **我的优惠券** - 优惠券管理、状态筛选 🆕
- 🛍️ 商品详情 - SKU选择、收藏、评价、**相关推荐** 🆕
- 🛒 购物车 - 商品管理、结算
- 📦 订单列表 - 订单管理、支付、**倒计时** 🆕
- ⭐ 收藏列表 - 收藏管理
- 🕐 浏览历史 - 历史记录

### 管理端界面
- 📊 数据仪表盘 - 销售统计、趋势图表
- 📦 商品管理 - CRUD、SKU管理
- 📋 订单管理 - 订单处理、状态更新
- 👥 用户管理 - 用户列表、消费统计
- 🎁 **优惠券管理** - 创建优惠券、状态管理 🆕

## 🐛 问题排查

如遇到问题，请查看：
1. [故障排查指南](./TROUBLESHOOTING.md) - 常见问题与解决方案
2. [前端开发日志](./docs/archive/开发日志_前端.md) - 前端常见问题（历史记录）
3. [后端开发日志](./docs/archive/开发日志_后端.md) - 后端常见问题（历史记录）
4. [管理后台开发记录](./docs/archive/开发日志_管理后台.md) - 管理后台问题（历史记录）

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

详细的贡献指南请查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 🆕

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
- 短信及订单通知邮件（密码重置邮件已支持 Gmail SMTP 和 Resend）
- 对象存储（OSS）
- CDN配置
- 监控告警系统
- 备份恢复方案
- 负载均衡配置

---

**最后更新**: 2026年10月7日 | **版本**: 3.0.0

## 🎉 v3.0.0 更新亮点 (2025-11-03)

### ✨ 新增功能
- 🎁 **完整的优惠券系统**
  - 用户端：优惠券中心、我的优惠券、优惠券领取和使用
  - 管理端：优惠券创建、状态管理
  - 3种优惠券类型：满减券、折扣券、无门槛券
  - 优惠券状态管理：待发放、进行中、已结束、已停用
  
- 👤 **个人中心页面**
  - 用户信息展示（蓝色渐变卡片）
  - 优惠券专区（橙红色醒目设计）
  - 功能菜单网格（6个快捷入口）
  - 统一的用户功能管理入口

- 🎯 **智能推荐系统**
  - 基于用户浏览历史的个性化推荐
  - 商品详情页相关商品推荐
  - 首页"猜你喜欢"推荐

- ⏰ **订单超时自动处理**
  - 30分钟未支付自动取消
  - 基于定时任务的订单状态管理

### 🐛 问题修复
- ✅ 修复 SQL 查询参数化问题（LIMIT/OFFSET）
- ✅ 修复字符编码问题（完整的 UTF-8 链路）
- ✅ 修复优惠券显示乱码
- ✅ 修复前端导入路径错误
- ✅ 优化用户体验和界面设计

### 📊 本版本统计
- 新增代码：5,944 行
- 新增页面：4 个
- 新增 API：15+ 个
- 新增数据库表：4 个
- 更新文档：3,365 行
