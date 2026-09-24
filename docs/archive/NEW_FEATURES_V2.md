# 新功能开发文档 V2.0

> 📅 更新日期: 2025年11月3日  
> 👨‍💻 版本: 2.0.0  
> 🎯 状态: 已完成

## 📋 目录

- [功能概述](#功能概述)
- [1. Elasticsearch 商品搜索](#1-elasticsearch-商品搜索)
- [2. RabbitMQ 消息队列](#2-rabbitmq-消息队列)
- [3. 优惠券系统](#3-优惠券系统)
- [部署指南](#部署指南)
- [测试指南](#测试指南)
- [API 文档](#api-文档)

---

## 功能概述

本次更新实现了三个核心功能模块，显著提升了电商平台的性能和用户体验：

### ✨ 核心功能

| 功能 | 说明 | 状态 |
|------|------|------|
| **Elasticsearch 搜索** | 全文搜索、多条件筛选、智能排序 | ✅ 已完成 |
| **RabbitMQ 消息队列** | 异步任务处理、订单解耦、库存管理 | ✅ 已完成 |
| **优惠券系统** | 优惠券创建、领取、使用、折扣计算 | ✅ 已完成 |

### 📊 技术指标

- **新增代码**: ~2,800 行
- **新增 API**: 12 个
- **新增数据表**: 3 个
- **新增服务**: 4 个
- **新增文档**: 本文档

---

## 1. Elasticsearch 商品搜索

### 🎯 功能特性

#### 1.1 全文搜索
- ✅ 支持商品标题、描述、品牌的全文搜索
- ✅ 使用 IK 中文分词器
- ✅ 支持模糊匹配（Fuzziness）
- ✅ 多字段权重搜索（标题权重 > 品牌权重 > 描述权重）

#### 1.2 高级筛选
- ✅ 分类筛选
- ✅ 价格区间筛选
- ✅ 品牌筛选
- ✅ 状态筛选（只显示上架商品）

#### 1.3 智能排序
- ✅ 销量排序
- ✅ 价格排序
- ✅ 时间排序
- ✅ 支持升序/降序

#### 1.4 分页支持
- ✅ 自定义页码和每页数量
- ✅ 返回总数和总页数

### 🗂️ 文件结构

```
backend/src/
├── database/
│   ├── elasticsearch.ts       # ES 连接和操作
│   └── sync-es.ts            # 数据同步脚本
├── controllers/
│   └── search.controller.ts  # 搜索控制器（已更新）
└── routes/
    └── search.routes.ts      # 搜索路由（已更新）
```

### 📝 核心代码

#### 索引映射配置

```typescript
mappings: {
  properties: {
    product_id: { type: 'integer' },
    title: {
      type: 'text',
      analyzer: 'ik_max_word_analyzer',
      search_analyzer: 'ik_smart_analyzer',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    description: {
      type: 'text',
      analyzer: 'ik_max_word_analyzer',
      search_analyzer: 'ik_smart_analyzer'
    },
    price: { type: 'float' },
    sales_count: { type: 'integer' },
    category_id: { type: 'integer' },
    brand: {
      type: 'text',
      analyzer: 'ik_max_word_analyzer',
      fields: {
        keyword: { type: 'keyword' }
      }
    }
  }
}
```

#### 搜索查询构建

```typescript
const must: any[] = [
  { term: { status: 1 } } // 只搜索上架商品
];

// 关键词搜索
if (keyword) {
  must.push({
    multi_match: {
      query: keyword,
      fields: ['title^3', 'description', 'brand^2'],
      type: 'best_fields',
      operator: 'or',
      fuzziness: 'AUTO'
    }
  });
}

// 价格范围筛选
if (min_price || max_price) {
  const range: any = {};
  if (min_price) range.gte = min_price;
  if (max_price) range.lte = max_price;
  must.push({ range: { price: range } });
}
```

### 🔌 API 接口

#### GET /api/search/es

**请求参数:**
```typescript
{
  keyword?: string;        // 搜索关键词
  category_id?: number;    // 分类ID
  min_price?: number;      // 最低价格
  max_price?: number;      // 最高价格
  brand?: string;          // 品牌
  sort_by?: 'price' | 'sales' | 'created_at';  // 排序字段
  sort_order?: 'asc' | 'desc';  // 排序方向
  page?: number;           // 页码（默认1）
  page_size?: number;      // 每页数量（默认20）
}
```

**响应示例:**
```json
{
  "success": true,
  "data": [
    {
      "product_id": 1,
      "title": "iPhone 15 Pro Max",
      "price": 8999.00,
      "sales_count": 1234,
      "_score": 2.5
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

### 🚀 使用示例

```bash
# 1. 同步商品数据到 Elasticsearch
cd backend
npm run build
npm run sync-es

# 2. 测试搜索
curl "http://localhost:3001/api/search/es?keyword=手机&page=1&page_size=10"

# 3. 价格筛选
curl "http://localhost:3001/api/search/es?keyword=手机&min_price=1000&max_price=5000"

# 4. 排序测试
curl "http://localhost:3001/api/search/es?keyword=手机&sort_by=price&sort_order=asc"
```

---

## 2. RabbitMQ 消息队列

### 🎯 功能特性

#### 2.1 订单消息队列
- ✅ 订单创建消息
- ✅ 订单支付消息
- ✅ 订单取消消息

#### 2.2 库存管理消息
- ✅ 库存扣减消息
- ✅ 库存恢复消息

#### 2.3 通知消息
- ✅ 邮件通知消息（模拟）

#### 2.4 消息可靠性
- ✅ 消息持久化
- ✅ 消息确认机制（ACK/NACK）
- ✅ 失败重试
- ✅ 连接重连

### 🗂️ 文件结构

```
backend/src/
├── database/
│   └── rabbitmq.ts                    # RabbitMQ 连接
├── services/
│   └── message-queue.service.ts       # 消息队列服务
└── index.ts                            # 启动消息消费者
```

### 📝 队列列表

| 队列名称 | 说明 | 处理器 |
|---------|------|--------|
| `order.created` | 订单创建 | `handleOrderCreated` |
| `order.paid` | 订单支付 | `handleOrderPaid` |
| `order.cancelled` | 订单取消 | `handleOrderCancelled` |
| `stock.deduction` | 库存扣减 | `handleStockDeduction` |
| `stock.recovery` | 库存恢复 | `handleStockRecovery` |
| `email.notification` | 邮件通知 | `handleEmailNotification` |

### 💡 核心功能

#### 发布消息

```typescript
import { publishMessage, QUEUES } from '../database/rabbitmq';

// 发布订单创建消息
await publishMessage(QUEUES.ORDER_CREATED, {
  order_id: 123,
  user_id: 456,
  items: [
    { sku_id: 1, quantity: 2 },
    { sku_id: 2, quantity: 1 }
  ],
  timestamp: new Date().toISOString()
});
```

#### 消费消息

```typescript
import { consumeQueue, QUEUES } from '../database/rabbitmq';

// 消费订单创建消息
await consumeQueue(QUEUES.ORDER_CREATED, async (message) => {
  const { order_id, user_id, items } = message;
  
  // 处理逻辑
  console.log(`处理订单: ${order_id}`);
  
  // 发送后续消息
  for (const item of items) {
    await publishMessage(QUEUES.STOCK_DEDUCTION, {
      order_id,
      sku_id: item.sku_id,
      quantity: item.quantity
    });
  }
});
```

### 🔄 消息流程

#### 订单创建流程

```
创建订单
    ↓
[order.created] → 处理器
    ↓
├─→ [stock.deduction] → 扣减库存
└─→ [email.notification] → 发送通知
```

#### 订单支付流程

```
支付订单
    ↓
[order.paid] → 处理器
    ↓
├─→ 更新商品销量
└─→ [email.notification] → 发送通知
```

#### 订单取消流程

```
取消订单
    ↓
[order.cancelled] → 处理器
    ↓
├─→ [stock.recovery] → 恢复库存
└─→ [email.notification] → 发送通知
```

### 🚀 使用示例

```typescript
// 在订单创建时发送消息
await sendOrderCreatedMessage(orderId, userId, items);

// 在订单支付时发送消息
await sendOrderPaidMessage(orderId, userId);

// 在订单取消时发送消息
await sendOrderCancelledMessage(orderId, userId, items);
```

---

## 3. 优惠券系统

### 🎯 功能特性

#### 3.1 优惠券类型
- ✅ 满减券（满 X 元减 Y 元）
- ✅ 折扣券（X 折优惠）
- ✅ 无门槛券（直接抵扣）

#### 3.2 优惠券管理
- ✅ 创建优惠券（管理员）
- ✅ 查看优惠券列表
- ✅ 查看优惠券详情
- ✅ 启用/禁用优惠券

#### 3.3 用户功能
- ✅ 领取优惠券
- ✅ 查看我的优惠券
- ✅ 查看可用优惠券
- ✅ 计算优惠金额
- ✅ 使用优惠券

#### 3.4 高级功能
- ✅ 领取限制（每人限领 N 张）
- ✅ 数量限制（库存管理）
- ✅ 时间限制（生效/失效时间）
- ✅ 最低消费限制
- ✅ 最大优惠限制（折扣券）
- ✅ 自动过期处理

### 🗂️ 数据库设计

#### 3.1 优惠券表 (coupons)

```sql
CREATE TABLE coupons (
  coupon_id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(50) UNIQUE NOT NULL,      -- 优惠券代码
  name VARCHAR(100) NOT NULL,            -- 优惠券名称
  description TEXT,                      -- 优惠券描述
  type TINYINT NOT NULL,                 -- 类型: 1=满减, 2=折扣, 3=无门槛
  discount_value DECIMAL(10,2) NOT NULL, -- 优惠值
  min_amount DECIMAL(10,2) DEFAULT 0,    -- 最低使用金额
  max_discount DECIMAL(10,2),            -- 最大优惠金额
  total_quantity INT NOT NULL,           -- 总发放数量
  remain_quantity INT NOT NULL,          -- 剩余数量
  per_user_limit INT DEFAULT 1,          -- 每人限领数量
  start_time DATETIME NOT NULL,          -- 生效时间
  end_time DATETIME NOT NULL,            -- 失效时间
  status TINYINT DEFAULT 1,              -- 状态: 0=禁用, 1=启用
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### 3.2 用户优惠券表 (user_coupons)

```sql
CREATE TABLE user_coupons (
  user_coupon_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,                  -- 用户ID
  coupon_id INT NOT NULL,                -- 优惠券ID
  status TINYINT DEFAULT 1,              -- 状态: 1=未使用, 2=已使用, 3=已过期
  used_at DATETIME,                      -- 使用时间
  order_id INT,                          -- 使用订单ID
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- 领取时间
  expired_at DATETIME NOT NULL,          -- 过期时间
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (coupon_id) REFERENCES coupons(coupon_id)
);
```

#### 3.3 优惠券使用记录表 (coupon_usage_logs)

```sql
CREATE TABLE coupon_usage_logs (
  log_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  coupon_id INT NOT NULL,
  user_coupon_id INT NOT NULL,
  order_id INT NOT NULL,
  discount_amount DECIMAL(10,2) NOT NULL, -- 优惠金额
  order_amount DECIMAL(10,2) NOT NULL,    -- 订单金额
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 🔌 API 接口

#### 用户端接口

##### 1. GET /api/coupons/available
获取可领取的优惠券列表

**请求参数:**
```typescript
{
  page?: number;
  page_size?: number;
}
```

##### 2. POST /api/coupons/receive
领取优惠券

**请求体:**
```json
{
  "code": "NEW2025"  // 优惠券代码
}
```

##### 3. GET /api/coupons/my/list
获取我的优惠券

**请求参数:**
```typescript
{
  status?: 1 | 2 | 3;  // 1=未使用, 2=已使用, 3=已过期
}
```

##### 4. GET /api/coupons/my/available-for-order
获取可用于订单的优惠券

**请求参数:**
```typescript
{
  amount: number;  // 订单金额
}
```

##### 5. POST /api/coupons/calculate
计算优惠金额

**请求体:**
```json
{
  "user_coupon_id": 1,
  "order_amount": 500
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "discount_amount": 50,
    "final_amount": 450
  }
}
```

#### 管理端接口

##### 1. POST /api/admin/coupons
创建优惠券

**请求体:**
```json
{
  "code": "NEW2025",
  "name": "新年优惠券",
  "description": "新年特惠，全场通用",
  "type": 1,
  "discount_value": 50,
  "min_amount": 200,
  "max_discount": null,
  "total_quantity": 1000,
  "per_user_limit": 1,
  "start_time": "2025-01-01 00:00:00",
  "end_time": "2025-12-31 23:59:59"
}
```

##### 2. GET /api/admin/coupons
获取优惠券列表

##### 3. GET /api/admin/coupons/:id
获取优惠券详情

##### 4. PUT /api/admin/coupons/:id/status
更新优惠券状态

### 💰 折扣计算逻辑

```typescript
calculateDiscount(coupon: Coupon, orderAmount: number): number {
  // 检查最低使用金额
  if (orderAmount < coupon.min_amount) {
    return 0;
  }

  let discount = 0;

  switch (coupon.type) {
    case CouponType.FULL_REDUCTION: // 满减券
      discount = coupon.discount_value;
      break;

    case CouponType.DISCOUNT: // 折扣券
      discount = orderAmount * (1 - coupon.discount_value / 100);
      if (coupon.max_discount && discount > coupon.max_discount) {
        discount = coupon.max_discount;
      }
      break;

    case CouponType.NO_THRESHOLD: // 无门槛券
      discount = coupon.discount_value;
      break;
  }

  // 优惠金额不能超过订单金额
  return Math.min(discount, orderAmount);
}
```

### 🚀 使用示例

#### 创建优惠券

```bash
curl -X POST http://localhost:3001/api/admin/coupons \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "code": "SUMMER50",
    "name": "夏季满减券",
    "description": "满200减50",
    "type": 1,
    "discount_value": 50,
    "min_amount": 200,
    "total_quantity": 1000,
    "per_user_limit": 1,
    "start_time": "2025-06-01 00:00:00",
    "end_time": "2025-08-31 23:59:59"
  }'
```

#### 领取优惠券

```bash
curl -X POST http://localhost:3001/api/coupons/receive \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"code": "SUMMER50"}'
```

#### 查看我的优惠券

```bash
curl -X GET "http://localhost:3001/api/coupons/my/list?status=1" \
  -H "Authorization: Bearer $USER_TOKEN"
```

---

## 部署指南

### 📋 环境要求

- Node.js 18+
- MySQL 8.0+
- Redis 7+
- MongoDB 7+
- **Elasticsearch 8.0+** 🆕
- **RabbitMQ 3.12+** 🆕

### 🐳 Docker Compose 部署

#### 1. 更新 docker-compose.yml

确保包含以下服务：

```yaml
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"
      - "9300:9300"
    volumes:
      - elasticsearch-data:/usr/share/elasticsearch/data

  rabbitmq:
    image: rabbitmq:3.12-management
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      - RABBITMQ_DEFAULT_USER=admin
      - RABBITMQ_DEFAULT_PASS=admin123
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq

volumes:
  elasticsearch-data:
  rabbitmq-data:
```

#### 2. 启动所有服务

```bash
docker-compose up -d
```

#### 3. 安装依赖

```bash
cd backend
npm install @elastic/elasticsearch
```

#### 4. 数据库迁移

```bash
# 创建优惠券表
npm run build
npm run migrate-coupon
```

#### 5. 同步数据到 Elasticsearch

```bash
npm run sync-es
```

#### 6. 启动后端服务

```bash
npm run dev
```

### 🔍 验证部署

```bash
# 1. 检查 Elasticsearch
curl http://localhost:9200

# 2. 检查 RabbitMQ 管理界面
open http://localhost:15672
# 用户名: admin, 密码: admin123

# 3. 检查后端服务
curl http://localhost:3001/health

# 4. 测试搜索功能
curl "http://localhost:3001/api/search/es?keyword=手机"
```

---

## 测试指南

### 🧪 自动化测试

运行测试脚本：

```bash
./test-new-features-v2.sh
```

### 📝 手动测试

#### 1. Elasticsearch 搜索测试

```bash
# 关键词搜索
curl "http://localhost:3001/api/search/es?keyword=手机&page=1&page_size=10"

# 价格筛选
curl "http://localhost:3001/api/search/es?keyword=手机&min_price=1000&max_price=5000"

# 分类筛选
curl "http://localhost:3001/api/search/es?category_id=1"

# 排序测试
curl "http://localhost:3001/api/search/es?sort_by=price&sort_order=asc"
```

#### 2. 优惠券系统测试

```bash
# 查看可领取优惠券
curl http://localhost:3001/api/coupons/available \
  -H "Authorization: Bearer $TOKEN"

# 领取优惠券
curl -X POST http://localhost:3001/api/coupons/receive \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"code": "NEW2025"}'

# 查看我的优惠券
curl "http://localhost:3001/api/coupons/my/list?status=1" \
  -H "Authorization: Bearer $TOKEN"
```

#### 3. 消息队列测试

查看后端日志，确认消息处理：

```bash
# 查看 Docker 日志
docker-compose logs -f backend

# 应该看到类似以下输出：
# 📨 收到消息 [order.created]: { order_id: 123, ... }
# ✅ 消息处理成功 [order.created]
```

---

## API 文档

### 📚 完整 API 列表

| 接口 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/api/search/es` | GET | Elasticsearch 搜索 | 公开 |
| `/api/coupons/available` | GET | 可领取优惠券 | 登录 |
| `/api/coupons/receive` | POST | 领取优惠券 | 登录 |
| `/api/coupons/my/list` | GET | 我的优惠券 | 登录 |
| `/api/coupons/my/available-for-order` | GET | 可用优惠券 | 登录 |
| `/api/coupons/calculate` | POST | 计算优惠 | 登录 |
| `/api/admin/coupons` | POST | 创建优惠券 | 管理员 |
| `/api/admin/coupons` | GET | 优惠券列表 | 管理员 |
| `/api/admin/coupons/:id` | GET | 优惠券详情 | 管理员 |
| `/api/admin/coupons/:id/status` | PUT | 更新状态 | 管理员 |

---

## 📊 性能优化

### Elasticsearch 优化

1. **索引优化**
   - 使用 IK 分词器提高中文搜索准确性
   - 合理设置字段权重
   - 使用 keyword 字段进行精确匹配

2. **查询优化**
   - 使用 bool 查询组合多个条件
   - 使用 term 查询进行精确匹配
   - 合理设置分页大小

### RabbitMQ 优化

1. **消息可靠性**
   - 消息持久化
   - 使用确认机制
   - 失败重试机制

2. **性能优化**
   - 合理设置预取数量
   - 使用连接池
   - 异步处理消息

### 优惠券系统优化

1. **并发控制**
   - 使用数据库锁（FOR UPDATE）
   - 乐观锁处理并发领取

2. **查询优化**
   - 添加索引（code, status, expired_at）
   - 使用连接查询减少查询次数

---

## 🐛 常见问题

### 1. Elasticsearch 连接失败

**问题**: `ECONNREFUSED 127.0.0.1:9200`

**解决**:
```bash
# 检查 ES 是否运行
docker ps | grep elasticsearch

# 重启 ES
docker-compose restart elasticsearch

# 等待 ES 启动完成
curl http://localhost:9200
```

### 2. RabbitMQ 连接失败

**问题**: `ECONNREFUSED 127.0.0.1:5672`

**解决**:
```bash
# 检查 RabbitMQ 是否运行
docker ps | grep rabbitmq

# 重启 RabbitMQ
docker-compose restart rabbitmq

# 访问管理界面
open http://localhost:15672
```

### 3. 优惠券领取失败

**问题**: "已达领取上限"

**解决**:
- 检查 `per_user_limit` 设置
- 查询 `user_coupons` 表确认领取次数

### 4. 搜索无结果

**问题**: ES 搜索返回空数组

**解决**:
```bash
# 同步数据到 ES
cd backend
npm run sync-es:dev

# 检查索引
curl http://localhost:9200/products/_count
```

---

## 📈 后续优化计划

### 短期计划（1-2周）

- [ ] 添加搜索词联想功能
- [ ] 实现优惠券批量导入
- [ ] 添加消息队列监控面板
- [ ] 优化 ES 搜索性能

### 中期计划（1个月）

- [ ] 实现优惠券活动管理
- [ ] 添加优惠券使用统计
- [ ] 实现商品智能推荐（基于 ES）
- [ ] 添加消息队列死信队列

### 长期计划（3个月）

- [ ] 实现分布式搜索
- [ ] 添加搜索结果个性化
- [ ] 实现复杂优惠规则引擎
- [ ] 完善消息队列监控和告警

---

## 📝 更新日志

### v2.0.0 (2025-11-03)

**新增功能:**
- ✅ Elasticsearch 商品搜索
- ✅ RabbitMQ 消息队列
- ✅ 优惠券系统

**技术改进:**
- ✅ 异步任务处理
- ✅ 全文搜索优化
- ✅ 消息可靠性保证

**文档更新:**
- ✅ 新功能开发文档
- ✅ API 接口文档
- ✅ 部署指南

---

## 👥 贡献者

- 开发: @Lushangtu123
- 测试: @Lushangtu123
- 文档: @Lushangtu123

---

## 📄 许可证

MIT License

---

**最后更新**: 2025年11月3日

