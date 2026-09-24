/**
 * Swagger / OpenAPI 文档配置
 *
 * 访问地址：/api-docs
 * 各路由文件中使用 `@openapi` JSDoc 注解描述接口，
 * 此处统一定义 tags、安全方案与通用 schema。
 */
import swaggerJSDoc from 'swagger-jsdoc';

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
          description: '用户登录 Token：Authorization: Bearer <token>',
        },
        adminAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '管理员 Token：Authorization: Bearer <admin_token>',
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
            price: { type: 'number' },
            original_price: { type: 'number', nullable: true },
            main_image: { type: 'string', nullable: true },
            stock: { type: 'integer' },
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
            product_id: { type: 'integer' },
            quantity: { type: 'integer' },
            product_name: { type: 'string' },
            price: { type: 'number' },
            product_image: { type: 'string', nullable: true },
          },
        },
        Order: {
          type: 'object',
          properties: {
            order_id: { type: 'integer' },
            order_no: { type: 'string' },
            user_id: { type: 'integer' },
            total_amount: { type: 'number' },
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
            discount_value: { type: 'number' },
            min_amount: { type: 'number' },
            max_discount: { type: 'number', nullable: true },
            total_quantity: { type: 'integer' },
            remain_quantity: { type: 'integer' },
            status: { type: 'integer', description: '1 启用，0 停用' },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
          },
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
  // 扫描路由文件中的 @openapi 注解；同时收录运维接口（index.ts）
  apis: ['./src/routes/*.ts', './src/index.ts'],
};

export const swaggerSpec = swaggerJSDoc(options);
