# API 文档 | API Documentation

本文档详细说明了电商平台所有可用的 API 接口。

**基础 URL**: `http://localhost:3001/api`  
**版本**: 2.0.0  
**最后更新**: 2025年10月31日

---

## 📋 目录

- [认证说明](#认证说明)
- [响应格式](#响应格式)
- [错误码](#错误码)
- [用户相关 API](#用户相关-api)
- [商品相关 API](#商品相关-api)
- [购物车 API](#购物车-api)
- [订单 API](#订单-api)
- [评论 API](#评论-api)
- [收藏 API](#收藏-api)
- [搜索 API](#搜索-api)
- [浏览历史 API](#浏览历史-api)
- [管理员 API](#管理员-api)

---

## 🔐 认证说明

### 会话 Cookie 认证

登录成功后，服务器通过 `Set-Cookie` 写入 httpOnly 会话 Cookie，响应体中**不再返回令牌**：

- 用户登录 / 注册: `POST /api/users/login`、`POST /api/users/register` → `customer_session`
- 管理员登录: `POST /api/admin/login` → `admin_session`

Cookie 属性为 `HttpOnly; SameSite=Lax; Path=/api`（生产环境另加 `Secure`），有效期与令牌一致。浏览器请求需携带 Cookie（axios `withCredentials: true`，fetch `credentials: 'include'`）。

使用 Cookie 认证的非 GET 请求必须带 `X-Requested-With: XMLHttpRequest` 请求头，否则返回 403（CSRF 防护）。

退出登录: `POST /api/users/logout`、`POST /api/admin/logout`（清除对应 Cookie）。

### 非浏览器客户端

脚本或其他服务可以保存 Cookie（如 `curl -c cookies.txt` / `-b cookies.txt`），也可以把 Cookie 的值作为 Bearer 令牌发送；同时提供时以 Bearer 为准：

```http
Authorization: Bearer <customer_session 或 admin_session 的值>
```

### Token 生命周期

- **有效期**: 7天
- **刷新**: Token 过期后需要重新登录
- **存储**: 只在 httpOnly Cookie 中，页面脚本无法读取

---

## 📦 响应格式

### 成功响应

```json
{
  "success": true,
  "data": {
    // 响应数据
  },
  "message": "操作成功"
}
```

### 错误响应

```json
{
  "success": false,
  "error": "错误信息",
  "code": "ERROR_CODE"
}
```

### 分页响应

```json
{
  "products": [...],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 100,
    "totalPages": 9
  }
}
```

---

## ⚠️ 错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `UNAUTHORIZED` | 401 | 未登录或 token 无效 |
| `FORBIDDEN` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION_ERROR` | 400 | 请求参数验证失败 |
| `DUPLICATE_ERROR` | 409 | 资源已存在（如邮箱重复） |
| `SERVER_ERROR` | 500 | 服务器内部错误 |
| `DATABASE_ERROR` | 500 | 数据库操作失败 |
| `INSUFFICIENT_STOCK` | 400 | 库存不足 |

---

## 👤 用户相关 API

### 1. 用户注册

注册新用户账号。

**接口**: `POST /api/users/register`  
**认证**: 不需要

**请求体**:
```json
{
  "username": "user123",
  "email": "user@example.com",
  "password": "password123",
  "phone": "13800138000"
}
```

**响应**:
```json
{
  "message": "注册成功",
  "user": {
    "id": 1,
    "username": "user123",
    "email": "user@example.com",
    "phone": "13800138000",
    "created_at": "2025-10-31T10:00:00.000Z"
  }
}
```

**错误**:
- `409`: 邮箱或用户名已存在
- `400`: 参数验证失败

---

### 2. 用户登录

用户登录；会话写入 httpOnly Cookie `customer_session`。

**接口**: `POST /api/users/login`  
**认证**: 不需要

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应**:
```json
{
  "message": "登录成功",
  "user": {
    "id": 1,
    "username": "user123",
    "email": "user@example.com"
  }
}
```

**错误**:
- `401`: 邮箱或密码错误
- `400`: 参数缺失

---

### 3. 获取用户信息

获取当前登录用户的详细信息。

**接口**: `GET /api/users/profile`  
**认证**: 需要

**响应**:
```json
{
  "id": 1,
  "username": "user123",
  "email": "user@example.com",
  "phone": "13800138000",
  "avatar": null,
  "created_at": "2025-10-31T10:00:00.000Z"
}
```

---

### 4. 更新用户信息

更新当前用户的个人信息。

**接口**: `PUT /api/users/profile`  
**认证**: 需要

**请求体**:
```json
{
  "username": "newusername",
  "phone": "13900139000",
  "avatar": "https://example.com/avatar.jpg"
}
```

**响应**:
```json
{
  "message": "更新成功",
  "user": {
    "id": 1,
    "username": "newusername",
    "email": "user@example.com",
    "phone": "13900139000"
  }
}
```

---

### 5. 获取收货地址列表

获取用户的所有收货地址。

**接口**: `GET /api/users/addresses`  
**认证**: 需要

**响应**:
```json
{
  "addresses": [
    {
      "id": 1,
      "receiver_name": "张三",
      "receiver_phone": "13800138000",
      "province": "北京市",
      "city": "北京市",
      "district": "朝阳区",
      "detail": "某某街道123号",
      "is_default": 1,
      "created_at": "2025-10-31T10:00:00.000Z"
    }
  ]
}
```

---

### 6. 添加收货地址

添加新的收货地址。

**接口**: `POST /api/users/addresses`  
**认证**: 需要

**请求体**:
```json
{
  "receiver_name": "张三",
  "receiver_phone": "13800138000",
  "province": "北京市",
  "city": "北京市",
  "district": "朝阳区",
  "detail": "某某街道123号",
  "is_default": true
}
```

**响应**:
```json
{
  "message": "添加成功",
  "address": {
    "id": 2,
    "receiver_name": "张三",
    // ... 其他字段
  }
}
```

---

## 🛍️ 商品相关 API

### 1. 获取商品列表

获取商品列表，支持分页、排序、筛选。

**接口**: `GET /api/products`  
**认证**: 不需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 | 默认值 |
|------|------|------|------|--------|
| `page` | number | 否 | 页码 | 1 |
| `limit` | number | 否 | 每页数量 | 12 |
| `category_id` | number | 否 | 分类ID | - |
| `keyword` | string | 否 | 搜索关键词 | - |
| `sort` | string | 否 | 排序方式 | `created_at DESC` |
| `min_price` | number | 否 | 最低价格 | - |
| `max_price` | number | 否 | 最高价格 | - |

**排序选项**:
- `price ASC`: 价格从低到高
- `price DESC`: 价格从高到低
- `created_at DESC`: 最新商品
- `sales DESC`: 销量从高到低

**示例请求**:
```
GET /api/products?page=1&limit=12&category_id=1&sort=price ASC
```

**响应**:
```json
{
  "products": [
    {
      "id": 1,
      "name": "商品名称",
      "description": "商品描述",
      "price": 99.99,
      "original_price": 199.99,
      "stock": 100,
      "sales": 50,
      "category_id": 1,
      "category_name": "电子产品",
      "images": ["https://example.com/image1.jpg"],
      "status": "active",
      "created_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 100,
    "totalPages": 9
  }
}
```

---

### 2. 获取商品详情

获取指定商品的详细信息，包括 SKU 规格。

**接口**: `GET /api/products/:id`  
**认证**: 不需要

**路径参数**:
- `id`: 商品ID

**响应**:
```json
{
  "id": 1,
  "name": "商品名称",
  "description": "详细描述",
  "price": 99.99,
  "original_price": 199.99,
  "stock": 100,
  "sales": 50,
  "category_id": 1,
  "category_name": "电子产品",
  "images": [
    "https://example.com/image1.jpg",
    "https://example.com/image2.jpg"
  ],
  "status": "active",
  "specs": {
    "brand": "品牌名",
    "model": "型号"
  },
  "skus": [
    {
      "id": 1,
      "product_id": 1,
      "sku_name": "红色-64GB",
      "sku_code": "SKU001",
      "price": 99.99,
      "stock": 50,
      "attributes": {
        "color": "红色",
        "storage": "64GB"
      }
    }
  ],
  "created_at": "2025-10-31T10:00:00.000Z",
  "updated_at": "2025-10-31T10:00:00.000Z"
}
```

**错误**:
- `404`: 商品不存在

---

### 3. 获取热门商品

获取热门商品列表（基于销量）。

**接口**: `GET /api/products/hot`  
**认证**: 不需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 | 默认值 |
|------|------|------|------|--------|
| `limit` | number | 否 | 数量 | 10 |

**响应**:
```json
{
  "products": [
    {
      "id": 1,
      "name": "热门商品",
      "price": 99.99,
      "sales": 1000,
      "images": ["https://example.com/image.jpg"]
    }
  ]
}
```

---

### 4. 搜索商品

根据关键词搜索商品。

**接口**: `GET /api/products/search`  
**认证**: 不需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `keyword` | string | 是 | 搜索关键词 |
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |

**示例请求**:
```
GET /api/products/search?keyword=手机&page=1&limit=12
```

**响应**: 格式同商品列表

---

### 5. 获取商品分类

获取所有商品分类。

**接口**: `GET /api/products/categories`  
**认证**: 不需要

**响应**:
```json
{
  "categories": [
    {
      "id": 1,
      "name": "电子产品",
      "parent_id": null,
      "sort_order": 1,
      "product_count": 150
    },
    {
      "id": 2,
      "name": "手机",
      "parent_id": 1,
      "sort_order": 1,
      "product_count": 80
    }
  ]
}
```

---

## 🛒 购物车 API

### 1. 获取购物车

获取当前用户的购物车内容。

**接口**: `GET /api/cart`  
**认证**: 需要

**响应**:
```json
{
  "cart_items": [
    {
      "id": 1,
      "product_id": 1,
      "product_name": "商品名称",
      "product_image": "https://example.com/image.jpg",
      "sku_id": 1,
      "sku_name": "红色-64GB",
      "price": 99.99,
      "quantity": 2,
      "stock": 50,
      "selected": true,
      "created_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "summary": {
    "total_items": 2,
    "selected_items": 2,
    "total_amount": 199.98
  }
}
```

---

### 2. 添加到购物车

将商品添加到购物车。

**接口**: `POST /api/cart`  
**认证**: 需要

**请求体**:
```json
{
  "product_id": 1,
  "sku_id": 1,
  "quantity": 2
}
```

**响应**:
```json
{
  "message": "添加成功",
  "cart_item": {
    "id": 1,
    "product_id": 1,
    "sku_id": 1,
    "quantity": 2
  }
}
```

**错误**:
- `400`: 库存不足
- `404`: 商品或SKU不存在

---

### 3. 更新购物车商品

更新购物车中商品的数量或选中状态。

**接口**: `PUT /api/cart/:id`  
**认证**: 需要

**路径参数**:
- `id`: 购物车项ID

**请求体**:
```json
{
  "quantity": 3,
  "selected": true
}
```

**响应**:
```json
{
  "message": "更新成功"
}
```

---

### 4. 删除购物车商品

从购物车中删除商品。

**接口**: `DELETE /api/cart/:id`  
**认证**: 需要

**路径参数**:
- `id`: 购物车项ID

**响应**:
```json
{
  "message": "删除成功"
}
```

---

### 5. 结算购物车

获取购物车结算信息。

**接口**: `POST /api/cart/checkout`  
**认证**: 需要

**请求体**:
```json
{
  "cart_item_ids": [1, 2, 3]
}
```

**响应**:
```json
{
  "items": [
    {
      "product_id": 1,
      "product_name": "商品名称",
      "sku_id": 1,
      "price": 99.99,
      "quantity": 2,
      "subtotal": 199.98
    }
  ],
  "summary": {
    "total_amount": 199.98,
    "shipping_fee": 10.00,
    "discount": 0,
    "final_amount": 209.98
  }
}
```

---

## 📦 订单 API

### 1. 创建订单

创建新订单。商品价格、优惠额和应付金额均由服务器计算，客户端只提交商品 ID、数量和可选的用户优惠券 ID。

**接口**: `POST /api/orders`  
**认证**: 需要

**请求体**:
```json
{
  "shipping_address_id": 1,
  "items": [
    {
      "product_id": 1,
      "quantity": 2
    }
  ],
  "remark": "请尽快发货",
  "user_coupon_id": 7
}
```

**响应**（201）:
```json
{
  "message": "订单创建成功",
  "order_id": 1,
  "original_amount": 20.20,
  "discount_amount": 4.04,
  "total_amount": 16.16
}
```

**错误**:
- `400`: 商品/数量无效、库存不足、地址无效或优惠券不可用
- `500`: 订单创建失败

下单在同一事务内写入订单、明细、优惠券占用及日志，扣减库存并清理已下单商品的购物车。所选券必须属于当前用户、未使用、已生效且未过期；禁用或未满门槛会返回错误，不能静默按原价创建订单。每单最多使用一张券，`discount_value=20` 表示优惠20%（8折），折扣券上限 null/0 表示不封顶。

### 结算预览

**接口**：`POST /api/orders/preview`，需要用户登录。请求体同创建订单中的 `items` 和可选 `user_coupon_id`，忽略客户端价格/金额。

```json
{
  "original_amount": 20.20,
  "discount_amount": 4.04,
  "total_amount": 16.16,
  "coupon": { "user_coupon_id": 7, "name": "八折优惠", "code": "SAVE20" },
  "available_coupons": [
    { "user_coupon_id": 7, "name": "八折优惠", "code": "SAVE20", "discount_amount": 4.04 }
  ]
}
```

未选择券时 `coupon=null`、优惠额为0。预览不占用库存、购物车或券；实际下单重新读取价格并校验券。订单详情保留 `original_amount`、`discount_amount`、`coupon_name` 和 `coupon_code` 快照。待支付订单取消或超时后只返还仍绑定该订单的券，有效券恢复可用、过期券标记为过期；支付保留已用状态，取消不增加券发行余量。

---

### 2. 获取订单列表

获取当前用户的订单列表。

**接口**: `GET /api/orders`  
**认证**: 需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |
| `status` | string | 否 | 订单状态 |

**订单状态**:
- `pending_payment`: 待支付
- `paid`: 已支付
- `shipped`: 已发货
- `completed`: 已完成
- `cancelled`: 已取消

**响应**:
```json
{
  "orders": [
    {
      "id": 1,
      "order_no": "ORD20251031001",
      "total_amount": 209.98,
      "status": "paid",
      "created_at": "2025-10-31T10:00:00.000Z",
      "items_count": 2,
      "first_product_image": "https://example.com/image.jpg"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 15,
    "totalPages": 2
  }
}
```

---

### 3. 获取订单详情

获取指定订单的详细信息。

**接口**: `GET /api/orders/:id`  
**认证**: 需要

**路径参数**:
- `id`: 订单ID

**响应**:
```json
{
  "id": 1,
  "order_no": "ORD20251031001",
  "user_id": 1,
  "total_amount": 209.98,
  "shipping_fee": 10.00,
  "discount_amount": 0,
  "final_amount": 209.98,
  "status": "paid",
  "payment_method": "alipay",
  "payment_time": "2025-10-31T10:05:00.000Z",
  "shipping_address": {
    "receiver_name": "张三",
    "receiver_phone": "13800138000",
    "address": "北京市朝阳区某某街道123号"
  },
  "items": [
    {
      "id": 1,
      "product_id": 1,
      "product_name": "商品名称",
      "product_image": "https://example.com/image.jpg",
      "sku_name": "红色-64GB",
      "price": 99.99,
      "quantity": 2,
      "subtotal": 199.98
    }
  ],
  "remark": "请尽快发货",
  "created_at": "2025-10-31T10:00:00.000Z",
  "updated_at": "2025-10-31T10:05:00.000Z"
}
```

**错误**:
- `404`: 订单不存在
- `403`: 无权访问该订单

---

### 4. 演示支付订单

**接口**: `POST /api/orders/:id/pay`，需用户认证。无需请求体；历史 payment_method 字段不会启用真实支付渠道。

先读取 `GET /api/payments/settings`，响应为 `{ "mode": "demo" | "disabled", "canPay": boolean, "isDemo": boolean }`。仅本地或 Vercel Preview 显式设置 `PAYMENT_MODE=demo` 时可用；生产环境强制禁用模拟支付。

成功响应为 `{ "message": "模拟支付完成，未实际扣款", "payment_mode": "demo" }`，订单记录 `payment_method=demo`。没有实际扣款或支付服务回调。

错误：`400` 订单状态不允许支付，`403` 无权操作他人订单，`404` 订单不存在，`503` 演示支付未启用。

---

### 5. 取消订单

取消待支付的订单。

**接口**: `POST /api/orders/:id/cancel`  
**认证**: 需要

**路径参数**:
- `id`: 订单ID

**请求体**:
```json
{
  "reason": "不想买了"
}
```

**响应**:
```json
{
  "message": "订单已取消"
}
```

**错误**:
- `400`: 订单状态不允许取消
- `404`: 订单不存在

---

### 6. 确认收货

确认订单已收货。

**接口**: `POST /api/orders/:id/confirm`  
**认证**: 需要

**路径参数**:
- `id`: 订单ID

**响应**:
```json
{
  "message": "确认收货成功"
}
```

**错误**:
- `400`: 订单状态不允许确认收货
- `404`: 订单不存在

---

## ⭐ 收藏 API

### 1. 添加收藏

将商品添加到收藏夹。

**接口**: `POST /api/favorites`  
**认证**: 需要

**请求体**:
```json
{
  "product_id": 1
}
```

**响应**:
```json
{
  "message": "收藏成功",
  "favorite": {
    "id": 1,
    "user_id": 1,
    "product_id": 1,
    "created_at": "2025-10-31T10:00:00.000Z"
  }
}
```

**错误**:
- `409`: 已收藏该商品
- `404`: 商品不存在

---

### 2. 取消收藏

从收藏夹中移除商品。

**接口**: `DELETE /api/favorites/:id`  
**认证**: 需要

**路径参数**:
- `id`: 收藏ID

**响应**:
```json
{
  "message": "取消收藏成功"
}
```

---

### 3. 获取收藏列表

获取当前用户的收藏列表。

**接口**: `GET /api/favorites`  
**认证**: 需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |

**响应**:
```json
{
  "favorites": [
    {
      "id": 1,
      "product_id": 1,
      "product_name": "商品名称",
      "product_price": 99.99,
      "product_image": "https://example.com/image.jpg",
      "product_stock": 100,
      "product_status": "active",
      "created_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 5,
    "totalPages": 1
  }
}
```

---

### 4. 检查是否已收藏

检查指定商品是否已收藏。

**接口**: `GET /api/favorites/check/:productId`  
**认证**: 需要

**路径参数**:
- `productId`: 商品ID

**响应**:
```json
{
  "is_favorited": true,
  "favorite_id": 1
}
```

---

## 🔍 搜索 API

### 1. 记录搜索历史

记录用户的搜索关键词。

**接口**: `POST /api/search/history`  
**认证**: 需要

**请求体**:
```json
{
  "keyword": "手机"
}
```

**响应**:
```json
{
  "message": "记录成功"
}
```

---

### 2. 获取搜索历史

获取当前用户的搜索历史。

**接口**: `GET /api/search/history`  
**认证**: 需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `limit` | number | 否 | 数量限制 |

**响应**:
```json
{
  "history": [
    {
      "id": 1,
      "keyword": "手机",
      "search_count": 5,
      "last_search_at": "2025-10-31T10:00:00.000Z"
    }
  ]
}
```

---

### 3. 删除搜索记录

删除指定的搜索记录。

**接口**: `DELETE /api/search/history/:keyword`  
**认证**: 需要

**路径参数**:
- `keyword`: 搜索关键词（URL编码）

**响应**:
```json
{
  "message": "删除成功"
}
```

---

### 4. 获取热门搜索

获取全站热门搜索关键词。

**接口**: `GET /api/search/hot`  
**认证**: 不需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `limit` | number | 否 | 数量限制（默认10） |

**响应**:
```json
{
  "hot_searches": [
    {
      "keyword": "iPhone",
      "search_count": 1523,
      "rank": 1
    },
    {
      "keyword": "笔记本",
      "search_count": 892,
      "rank": 2
    }
  ]
}
```

---

## 🕐 浏览历史 API

### 1. 记录浏览历史

记录用户浏览的商品。

**接口**: `POST /api/browse`  
**认证**: 需要

**请求体**:
```json
{
  "product_id": 1
}
```

**响应**:
```json
{
  "message": "记录成功"
}
```

---

### 2. 获取浏览历史

获取当前用户的浏览历史。

**接口**: `GET /api/browse`  
**认证**: 需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |

**响应**:
```json
{
  "history": [
    {
      "id": "ObjectId",
      "user_id": 1,
      "product_id": 1,
      "product_name": "商品名称",
      "product_price": 99.99,
      "product_image": "https://example.com/image.jpg",
      "browsed_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50
  }
}
```

---

### 3. 删除浏览记录

删除指定的浏览记录。

**接口**: `DELETE /api/browse/:id`  
**认证**: 需要

**路径参数**:
- `id`: 浏览记录ID

**响应**:
```json
{
  "message": "删除成功"
}
```

---

### 4. 清空浏览历史

清空当前用户的所有浏览历史。

**接口**: `DELETE /api/browse`  
**认证**: 需要

**响应**:
```json
{
  "message": "清空成功"
}
```

---

## 💬 评论 API

### 1. 创建评论

为已购商品创建评论。

**接口**: `POST /api/reviews`  
**认证**: 需要

**请求体**:
```json
{
  "order_id": 1,
  "product_id": 1,
  "rating": 5,
  "content": "非常好的商品，强烈推荐！",
  "images": [
    "https://example.com/review1.jpg"
  ]
}
```

**响应**:
```json
{
  "message": "评论成功",
  "review": {
    "id": 1,
    "user_id": 1,
    "product_id": 1,
    "rating": 5,
    "content": "非常好的商品，强烈推荐！",
    "created_at": "2025-10-31T10:00:00.000Z"
  }
}
```

**错误**:
- `400`: 未购买该商品或已评论
- `404`: 订单或商品不存在

---

### 2. 获取商品评论

获取指定商品的评论列表。

**接口**: `GET /api/reviews/product/:id`  
**认证**: 不需要

**路径参数**:
- `id`: 商品ID

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |
| `rating` | number | 否 | 筛选评分(1-5) |

**响应**:
```json
{
  "reviews": [
    {
      "id": 1,
      "user_id": 1,
      "username": "user123",
      "user_avatar": null,
      "rating": 5,
      "content": "非常好的商品，强烈推荐！",
      "images": ["https://example.com/review1.jpg"],
      "created_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "statistics": {
    "total_reviews": 100,
    "average_rating": 4.5,
    "rating_distribution": {
      "5": 60,
      "4": 25,
      "3": 10,
      "2": 3,
      "1": 2
    }
  },
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

---

### 3. 获取我的评论

获取当前用户的所有评论。

**接口**: `GET /api/reviews/my`  
**认证**: 需要

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |

**响应**:
```json
{
  "reviews": [
    {
      "id": 1,
      "product_id": 1,
      "product_name": "商品名称",
      "product_image": "https://example.com/image.jpg",
      "rating": 5,
      "content": "非常好的商品，强烈推荐！",
      "created_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "totalPages": 1
  }
}
```

---

## 👨‍💼 管理员 API

### 管理员登录

**接口**: `POST /api/admin/login`  
**认证**: 不需要

**请求体**:
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**响应**:
```json
{
  "message": "登录成功",
  "admin": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "permissions": ["all"]
  }
}
```

---

### 数据统计

#### 获取统计数据

**接口**: `GET /api/admin/dashboard/stats`  
**认证**: 需要（管理员）

**响应**:
```json
{
  "users_count": 1523,
  "products_count": 256,
  "orders_count": 3847,
  "revenue": 125680.50,
  "today_orders": 45,
  "today_revenue": 8960.00
}
```

---

#### 获取销售趋势

**接口**: `GET /api/admin/dashboard/sales-trend`  
**认证**: 需要（管理员）

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `days` | number | 否 | 天数（默认7天） |

**响应**:
```json
{
  "trend": [
    {
      "date": "2025-10-25",
      "orders": 45,
      "revenue": 8960.00
    },
    {
      "date": "2025-10-26",
      "orders": 52,
      "revenue": 10250.00
    }
  ]
}
```

---

#### 获取热门商品

**接口**: `GET /api/admin/dashboard/top-products`  
**认证**: 需要（管理员）

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `days` | number | 否 | 统计天数（默认7天） |
| `limit` | number | 否 | 数量限制（默认5） |

**响应**:
```json
{
  "products": [
    {
      "product_id": 1,
      "product_name": "商品名称",
      "sales": 156,
      "revenue": 15444.00
    }
  ]
}
```

---

### 商品管理

#### 获取所有商品

**接口**: `GET /api/admin/products`  
**认证**: 需要（管理员）

**查询参数**: 同普通商品列表，额外支持 `status` 筛选

---

#### 创建商品

**接口**: `POST /api/admin/products`  
**认证**: 需要（管理员）

**请求体**:
```json
{
  "name": "新商品",
  "description": "商品描述",
  "category_id": 1,
  "price": 99.99,
  "original_price": 199.99,
  "stock": 100,
  "images": ["https://example.com/image.jpg"],
  "specs": {
    "brand": "品牌",
    "model": "型号"
  },
  "status": "active"
}
```

**响应**:
```json
{
  "message": "创建成功",
  "product": {
    "id": 1,
    "name": "新商品",
    // ... 其他字段
  }
}
```

---

#### 更新商品

**接口**: `PUT /api/admin/products/:id`  
**认证**: 需要（管理员）

**请求体**: 同创建商品（部分字段可选）

---

#### 更新商品状态

**接口**: `PUT /api/admin/products/:id/status`  
**认证**: 需要（管理员）

**请求体**:
```json
{
  "status": "inactive"
}
```

**状态值**:
- `active`: 上架
- `inactive`: 下架
- `draft`: 草稿

---

#### 批量更新状态

**接口**: `PUT /api/admin/products/batch/status`  
**认证**: 需要（管理员）

**请求体**:
```json
{
  "product_ids": [1, 2, 3],
  "status": "active"
}
```

---

### SKU 管理

#### 获取商品 SKU

**接口**: `GET /api/admin/products/:id/skus`  
**认证**: 需要（管理员）

**响应**:
```json
{
  "skus": [
    {
      "id": 1,
      "product_id": 1,
      "sku_name": "红色-64GB",
      "sku_code": "SKU001",
      "price": 99.99,
      "stock": 50,
      "attributes": {
        "color": "红色",
        "storage": "64GB"
      }
    }
  ]
}
```

---

#### 创建 SKU

**接口**: `POST /api/admin/products/:id/skus`  
**认证**: 需要（管理员）

**请求体**:
```json
{
  "sku_name": "红色-64GB",
  "sku_code": "SKU001",
  "price": 99.99,
  "stock": 50,
  "attributes": {
    "color": "红色",
    "storage": "64GB"
  }
}
```

---

#### 批量创建 SKU

**接口**: `POST /api/admin/products/:id/skus/batch`  
**认证**: 需要（管理员）

**请求体**:
```json
{
  "skus": [
    {
      "sku_name": "红色-64GB",
      "sku_code": "SKU001",
      "price": 99.99,
      "stock": 50,
      "attributes": {"color": "红色", "storage": "64GB"}
    },
    {
      "sku_name": "蓝色-128GB",
      "sku_code": "SKU002",
      "price": 129.99,
      "stock": 30,
      "attributes": {"color": "蓝色", "storage": "128GB"}
    }
  ]
}
```

---

### 订单管理

#### 获取所有订单

**接口**: `GET /api/admin/orders`  
**认证**: 需要（管理员）

**查询参数**: 同用户订单列表，支持按状态、日期筛选

---

#### 更新订单状态

**接口**: `PUT /api/admin/orders/:id`  
**认证**: 需要（管理员）

**请求体**:
```json
{
  "status": "shipped",
  "tracking_no": "SF1234567890"
}
```

---

#### 获取订单详情

**接口**: `GET /api/admin/orders/:id`  
**认证**: 需要（管理员）

**响应**: 同用户订单详情，额外包含用户信息

---

### 用户管理

#### 获取所有用户

**接口**: `GET /api/admin/users`  
**认证**: 需要（管理员）

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |
| `keyword` | string | 否 | 搜索关键词 |

**响应**:
```json
{
  "users": [
    {
      "id": 1,
      "username": "user123",
      "email": "user@example.com",
      "phone": "13800138000",
      "order_count": 15,
      "total_spent": 2580.50,
      "created_at": "2025-10-31T10:00:00.000Z",
      "last_login_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1523,
    "totalPages": 77
  }
}
```

---

#### 获取用户详情

**接口**: `GET /api/admin/users/:id`  
**认证**: 需要（管理员）

**响应**:
```json
{
  "user": {
    "id": 1,
    "username": "user123",
    "email": "user@example.com",
    "phone": "13800138000",
    "created_at": "2025-10-31T10:00:00.000Z"
  },
  "statistics": {
    "order_count": 15,
    "total_spent": 2580.50,
    "favorite_count": 8,
    "review_count": 12
  },
  "recent_orders": [
    // 最近5个订单
  ]
}
```

---

### 系统日志

#### 获取操作日志

**接口**: `GET /api/admin/logs`  
**认证**: 需要（管理员）

**查询参数**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | number | 否 | 页码 |
| `limit` | number | 否 | 每页数量 |
| `action` | string | 否 | 操作类型 |
| `admin_id` | number | 否 | 管理员ID |

**响应**:
```json
{
  "logs": [
    {
      "id": 1,
      "admin_id": 1,
      "admin_username": "admin",
      "action": "create_product",
      "description": "创建商品: 新商品名称",
      "ip": "127.0.0.1",
      "created_at": "2025-10-31T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 500,
    "totalPages": 25
  }
}
```

---

## 📝 请求示例

### cURL

```bash
# 用户注册
curl -X POST http://localhost:3001/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123"
  }'

# 获取商品列表
curl -X GET "http://localhost:3001/api/products?page=1&limit=12"

# 登录并保存会话 Cookie
curl -c cookies.txt -X POST http://localhost:3001/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}'

# 添加到购物车（需要登录；Cookie 认证的写请求需带 X-Requested-With）
curl -b cookies.txt -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d '{
    "product_id": 1,
    "sku_id": 1,
    "quantity": 2
  }'
```

### JavaScript (Axios)

```javascript
// 浏览器会自动保存并发送 httpOnly 会话 Cookie
const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' }
});

// 登录
const login = async () => {
  const response = await api.post('/users/login', {
    email: 'user@example.com',
    password: 'password123'
  });
  return response.data.user;
};

// 获取商品列表
const getProducts = async () => {
  const response = await api.get('/products', {
    params: {
      page: 1,
      limit: 12,
      category_id: 1
    }
  });
  return response.data;
};

// 创建订单（会话 Cookie 自动随请求发送）
const createOrder = async (orderData) => {
  const response = await api.post('/orders', orderData);
  return response.data;
};
```

---

## 🔧 开发工具

### Postman Collection

建议使用 Postman 测试 API。可以导入以下集合：

1. 设置环境变量：
   - `base_url`: `http://localhost:3001/api`

2. 先调用登录接口，Postman 会保存返回的会话 Cookie 并在之后的请求中自动发送。

3. 非 GET 请求添加请求头：
   ```
   X-Requested-With: XMLHttpRequest
   ```

### 测试账号

**普通用户**:
- 邮箱: `test@example.com`
- 密码: `password123`

**管理员**:
- 用户名: `admin`
- 密码: `admin123`

---

## 📚 相关文档

- [README](./README.md) - 项目概述
- [环境变量配置](./ENV_SETUP.md) - 环境配置指南
- [快速启动指南](./QUICK_START_GUIDE.md) - 快速开始
- [部署文档](./DEPLOYMENT.md) - 部署说明

---

## 🔗 反馈与支持

如果您在使用 API 时遇到问题或有任何建议，请：

1. 查看相关文档
2. 检查请求参数和认证信息
3. 在 GitHub 上提交 Issue

---

**最后更新**: 2025年10月31日  
**版本**: 2.0.0  
**维护者**: Full-Stack Development Team




## 账户安全、物流与售后审核

| 接口 | 请求与行为 |
| --- | --- |
| `GET /api/users/password/capabilities` | 返回 passwordResetAvailable、passwordMinLength=12、passwordMaxBytes=72，无凭据 |
| `PUT /api/users/password` | 用户认证，body 为 currentPassword、newPassword；验证旧密码，改密后撤销所有旧 JWT |
| `POST /api/users/password/forgot` | body 为 email；配置 Resend 后已知、未知邮箱返回相同提示；每 IP 每 15 分钟最多 5 次；未配置返回 503 |
| `POST /api/users/password/reset` | body 为 token（64 位小写十六进制）、newPassword；凭据 30 分钟有效且仅能使用一次，成功后撤销所有旧会话 |
| `PUT /api/admin/orders/:id/status` | 发货 status=2 时必须同时提供 shipping_company（1–60 字符）、tracking_number（1–100 字符）；只允许从已支付订单发货 |
| `GET /api/orders/:id/after-sales` | 用户认证，读取本人订单的申请 |
| `POST /api/orders/:id/after-sales` | body 为 type（refund / return）、reason（1–500 字符）；已支付、已发货或已完成订单可申请，每订单最多一次 |
| `POST /api/orders/:id/after-sales/withdraw` | 用户认证，只能撤回待审核申请 |
| `GET /api/admin/after-sales` | 需 order:view 权限；page、limit、status 分页筛选 |
| `POST /api/admin/after-sales/:id/review` | 需 order:edit 权限；body 为 status（approved / rejected）、note（1–500 字符），审核和审计原子写入 |

新密码至少 12 字符，最多 72 个 UTF-8 字节，保留空白；注册和历史登录保留兼容规则。重置原文凭据不存入数据库，不在响应或日志中返回，邮件链接放入 URL 片段。账户重置成功后须使用新密码重新登录。

售后记录使用 request_id、review_note 字段，状态为 requested / approved / rejected / withdrawn。审核通过只保存审核结果，不代表已退款，不改变订单状态或库存。真实收款、退款与邮件发送依赖运营方的外部服务。
