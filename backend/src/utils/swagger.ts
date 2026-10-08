/**
 * Swagger / OpenAPI 文档配置
 *
 * 访问地址：/api-docs
 * 各路由文件中使用 `@openapi` JSDoc 注解描述接口，
 * 此处统一定义 tags、安全方案与通用 schema。
 */
import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'E-commerce API',
      version: '1.0.0',
      description:
        '电商平台后端接口文档。用户端接口使用 Bearer Token（登录后获取），管理后台接口使用管理员 Token。',
    },
    servers: [{ url: '/', description: '当前服务器' }],
    tags: [
      { name: '用户', description: '注册 / 登录 / 个人信息' },
      { name: '商品', description: '商品列表 / 详情 / 分类（公开接口）' },
      { name: '购物车', description: '需登录' },
      { name: '订单', description: '需登录' },
      { name: '收货地址', description: '需登录，仅可管理本人地址' },
      { name: '评论', description: '商品评论' },
      { name: '收藏', description: '需登录' },
      { name: '搜索', description: '关键词搜索 / 热搜 / 搜索历史' },
      { name: '浏览历史', description: '需登录' },
      { name: '推荐', description: '个性化 / 相关商品推荐' },
      { name: '优惠券', description: '需登录' },
      { name: '管理后台', description: '登录 / 仪表盘 / 操作日志（需管理员 Token）' },
      { name: '管理后台-商品', description: '需管理员 Token' },
      { name: '管理后台-订单', description: '需管理员 Token' },
      { name: '管理后台-用户', description: '需管理员 Token' },
      { name: '管理后台-优惠券', description: '需管理员 Token' },
      { name: '运维', description: '健康检查' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '非浏览器客户端可把 customer_session Cookie 的值作为 Authorization: Bearer <token> 发送；登录接口不在响应体中返回令牌。',
        },
        adminAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '非浏览器客户端可把 admin_session Cookie 的值作为 Authorization: Bearer <token> 发送；登录接口不在响应体中返回令牌。',
        },
        customerCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'customer_session',
          description: '登录后由服务器写入的 httpOnly 会话 Cookie；非 GET 请求还需 X-Requested-With 请求头。同时带 Bearer 时以 Bearer 为准。',
        },
        adminCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'admin_session',
          description: '管理员登录后写入的 httpOnly 会话 Cookie；非 GET 请求还需 X-Requested-With 请求头。',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: '参数错误' },
            error: { type: 'string', example: '参数错误' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            page_size: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
          },
        },
        Category: {
          type: 'object',
          properties: {
            category_id: { type: 'integer' },
            name: { type: 'string' },
            parent_id: { type: 'integer', nullable: true },
          },
        },
        Product: {
          type: 'object',
          properties: {
            product_id: { type: 'integer' },
            title: { type: 'string' },
            title_en: { type: 'string', nullable: true, maxLength: 200 },
            description: { type: 'string', nullable: true },
            description_en: { type: 'string', nullable: true },
            specs: { type: 'object', nullable: true, additionalProperties: true },
            specs_en: { $ref: '#/components/schemas/SpecsTranslation' },
            price: { type: 'number' },
            original_price: { type: 'number', nullable: true },
            main_image: { type: 'string', nullable: true },
            stock: { type: 'integer' },
            rating: { type: 'number', minimum: 0, maximum: 5, description: '已发布购买评价的平均分，保留两位小数；暂无评价时为 0' },
            review_count: { type: 'integer', minimum: 0, description: '已发布购买评价数量；前台为 0 时显示暂无评价' },
            sales: { type: 'integer' },
            status: { type: 'integer', description: '1 上架，0 下架' },
            category_id: { type: 'integer' },
          },
        },
        Sku: {
          type: 'object',
          properties: {
            sku_id: { type: 'integer' },
            product_id: { type: 'integer' },
            sku_code: { type: 'string' },
            specs: { type: 'object', description: '规格键值对，如 {颜色:"红",尺码:"M"}' },
            specs_en: { $ref: '#/components/schemas/SpecsTranslation' },
            price: { type: 'number' },
            original_price: { type: 'number', nullable: true },
            stock: { type: 'integer' },
            image: { type: 'string', nullable: true },
            status: { type: 'integer' },
          },
        },
        CartItem: {
          type: 'object',
          properties: {
            sku_id: { type: 'integer', nullable: true, description: '所选规格；null 为普通商品' },
            sku_code: { type: 'string', nullable: true },
            sku_specs: { type: 'object', nullable: true, additionalProperties: true },
            sku_specs_en: { $ref: '#/components/schemas/SpecsTranslation' },
            available: { type: 'boolean', description: '是否可勾选结算' },
            unavailable_reason: { type: 'string', nullable: true },
            product_id: { type: 'integer' },
            title: { type: 'string' },
            title_en: { type: 'string', nullable: true },
            quantity: { type: 'integer' },
            product_name: { type: 'string' },
            price: { type: 'number' },
            product_image: { type: 'string', nullable: true },
          },
        },
        SpecsTranslation: {
          type: 'object', nullable: true, maxProperties: 20,
          description: '按原始规格键映射翻译（键1至50字符）；name/value至少有一个且不得空白，缺失部分使用原始键/值，原始number和boolean保持。',
          additionalProperties: {
            type: 'object', minProperties: 1, additionalProperties: false,
            properties: { name: { type: 'string', minLength: 1, maxLength: 50 }, value: { type: 'string', minLength: 1, maxLength: 100 } },
          },
        },
        OrderItem: {
          type: 'object',
          properties: {
            item_id: { type: 'integer' }, order_id: { type: 'integer' }, product_id: { type: 'integer' },
            product_name: { type: 'string' }, product_name_en: { type: 'string', nullable: true, maxLength: 200 },
            product_image: { type: 'string', nullable: true }, sku_id: { type: 'integer', nullable: true },
            sku_code: { type: 'string', nullable: true }, sku_specs: { type: 'object', nullable: true, additionalProperties: true },
            sku_specs_en: { $ref: '#/components/schemas/SpecsTranslation' }, quantity: { type: 'integer' }, price: { type: 'number' },
          },
        },
        OrderDetail: {
          type: 'object',
          properties: {
            order: { $ref: '#/components/schemas/Order' },
            items: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } },
          },
        },
        AddressInput: {
          type: 'object', additionalProperties: false,
          required: ['receiver_name', 'phone', 'province', 'city', 'district', 'detail_address'],
          properties: {
            receiver_name: { type: 'string', minLength: 1, maxLength: 50 },
            phone: { type: 'string', minLength: 7, maxLength: 20, description: '7 至 15 位数字，可使用前导 +、空格或连字符' },
            province: { type: 'string', minLength: 1, maxLength: 50 },
            city: { type: 'string', minLength: 1, maxLength: 50 },
            district: { type: 'string', minLength: 1, maxLength: 50 },
            detail_address: { type: 'string', minLength: 1, maxLength: 200 },
            is_default: { type: 'boolean' },
          },
        },
        Address: {
          type: 'object',
          properties: {
            address_id: { type: 'integer' }, user_id: { type: 'integer' },
            receiver_name: { type: 'string' }, phone: { type: 'string' },
            province: { type: 'string', nullable: true }, city: { type: 'string', nullable: true },
            district: { type: 'string', nullable: true }, detail_address: { type: 'string', nullable: true },
            is_default: { type: 'boolean' }, created_at: { type: 'string', format: 'date-time' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            order_id: { type: 'integer' },
            order_no: { type: 'string' },
            user_id: { type: 'integer' },
            total_amount: { type: 'number' },
            original_amount: { type: 'number', nullable: true, description: '商品原价，历史未迁移订单可为空' },
            discount_amount: { type: 'number', description: '优惠金额' },
            user_coupon_id: { type: 'integer', nullable: true },
            coupon_name: { type: 'string', nullable: true, description: '下单时优惠券名称快照' },
            coupon_code: { type: 'string', nullable: true },
            shipping_address_id: { type: 'integer', nullable: true },
            shipping_address_snapshot: {
              type: 'object', nullable: true, description: '下单时收货信息，历史订单无法恢复时为空',
              properties: {
                receiver_name: { type: 'string' }, phone: { type: 'string' },
                province: { type: 'string', nullable: true }, city: { type: 'string', nullable: true },
                district: { type: 'string', nullable: true }, detail_address: { type: 'string', nullable: true },
              },
            },
            status: { type: 'integer', description: '待支付/已支付/已发货/已完成/已取消等' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Coupon: {
          type: 'object',
          properties: {
            coupon_id: { type: 'integer' },
            code: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'integer', description: '1 满减，2 折扣，3 无门槛' },
            discount_value: { type: 'number', description: '金额或减免百分比，20表示优惠20%即8折' },
            min_amount: { type: 'number' },
            max_discount: { type: 'number', nullable: true, description: '折扣券优惠上限，null或0表示不封顶' },
            total_quantity: { type: 'integer' },
            remain_quantity: { type: 'integer' },
            status: { type: 'integer', description: '1 启用，0 停用' },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
          },
        },
        AdminCoupon: {
          allOf: [
            { $ref: '#/components/schemas/Coupon' },
            { type: 'object', required: ['received_count', 'used_count'], properties: {
              received_count: { type: 'integer', minimum: 0, description: '该券全部领取记录数，包含未使用、已使用和已过期' },
              used_count: { type: 'integer', minimum: 0, description: '当前状态为已使用的领取记录数，取消订单返还后不计入' },
            } },
          ],
        },
        Review: {
          type: 'object',
          properties: {
            review_id: { type: 'integer' },
            product_id: { type: 'integer' },
            user_id: { type: 'integer' },
            rating: { type: 'integer', description: '1-5 星' },
            content: { type: 'string' },
            images: { type: 'array', items: { type: 'string' } },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          properties: {
            user_id: { type: 'integer' },
            username: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string', nullable: true },
            avatar_url: { type: 'string', nullable: true },
            status: { type: 'integer' },
          },
        },
        AdminLog: {
          type: 'object',
          properties: {
            log_id: { type: 'integer' },
            admin_id: { type: 'integer' },
            username: { type: 'string' },
            action: { type: 'string', example: 'CREATE_PRODUCT' },
            resource_type: { type: 'string', example: 'product' },
            resource_id: { type: 'string', nullable: true },
            description: { type: 'string' },
            ip_address: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
      parameters: {
        PageParam: {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', default: 1 },
          description: '页码',
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', default: 20 },
          description: '每页数量',
        },
      },
    },
  },
  // Resolve from this module so builds work from the repository or frontend directory.
  apis: [path.resolve(__dirname, '../../src/routes/*.ts'), path.resolve(__dirname, '../../src/app.ts')],
};

export const swaggerSpec = swaggerJSDoc(options);
