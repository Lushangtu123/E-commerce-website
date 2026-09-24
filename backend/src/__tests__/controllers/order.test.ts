/**
 * 订单核心流程测试
 * 覆盖：创建订单全链路（库存校验→创建→扣库存→清缓存→清购物车→MQ 超时消息）、订单详情权限校验
 */
import { Response } from 'express';

jest.mock('../../models/order.model', () => ({
  OrderModel: {
    create: jest.fn(),
    findById: jest.fn(),
    getOrderItems: jest.fn(),
  },
  OrderStatus: { PENDING: 0, PAID: 1, SHIPPED: 2, DONE: 3, CANCELLED: 4 },
}));

jest.mock('../../models/product.model', () => ({
  ProductModel: { findById: jest.fn(), decrStock: jest.fn() },
}));

jest.mock('../../models/cart.model', () => ({
  CartModel: { removeMultiple: jest.fn() },
}));

jest.mock('../../database/redis', () => ({
  getRedisClient: jest.fn(() => ({ del: jest.fn().mockResolvedValue(1) })),
}));

jest.mock('../../services/message-queue.service', () => ({
  sendOrderTimeoutCheckMessage: jest.fn(),
}));

jest.mock('../../services/order-timeout.service', () => ({
  getOrderRemainingTime: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OrderModel } = require('../../models/order.model');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ProductModel } = require('../../models/product.model');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CartModel } = require('../../models/cart.model');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendOrderTimeoutCheckMessage } = require('../../services/message-queue.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OrderController } = require('../../controllers/order.controller');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('../../utils/logger').default;

function mockRes() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const PRODUCT = {
  product_id: 1,
  title: '测试商品',
  price: 99,
  stock: 10,
  main_image: 'img.jpg',
};

beforeEach(() => jest.clearAllMocks());

describe('create 创建订单', () => {
  test('全链路成功：201 并依次调用创建/扣库存/清购物车/发MQ消息', async () => {
    ProductModel.findById.mockResolvedValue(PRODUCT);
    OrderModel.create.mockResolvedValue(1001);
    sendOrderTimeoutCheckMessage.mockResolvedValue(true);

    const req = {
      userId: 7,
      body: { items: [{ product_id: 1, quantity: 2 }], shipping_address_id: 3, remark: '尽快' },
    } as any;
    const res = mockRes();

    await OrderController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 1001 })
    );
    // 订单金额 = 99 * 2
    expect(OrderModel.create).toHaveBeenCalledWith(
      7,
      expect.arrayContaining([
        expect.objectContaining({ product_id: 1, quantity: 2, price: 99 }),
      ]),
      198,
      3,
      '尽快'
    );
    expect(ProductModel.decrStock).toHaveBeenCalledWith(1, 2);
    expect(CartModel.removeMultiple).toHaveBeenCalledWith(7, [1]);
    expect(sendOrderTimeoutCheckMessage).toHaveBeenCalledWith(1001, 7);
  });

  test('MQ 发送失败时订单仍创建成功（定时任务兜底），并记 warn', async () => {
    ProductModel.findById.mockResolvedValue(PRODUCT);
    OrderModel.create.mockResolvedValue(1002);
    sendOrderTimeoutCheckMessage.mockResolvedValue(false);

    const req = {
      userId: 7,
      body: { items: [{ product_id: 1, quantity: 1 }] },
    } as any;
    const res = mockRes();

    await OrderController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('定时任务兜底')
    );
  });

  test('订单商品为空时返回 400', async () => {
    const req = { userId: 7, body: { items: [] } } as any;
    const res = mockRes();

    await OrderController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(OrderModel.create).not.toHaveBeenCalled();
  });

  test('商品不存在时返回 400', async () => {
    ProductModel.findById.mockResolvedValue(null);

    const req = {
      userId: 7,
      body: { items: [{ product_id: 999, quantity: 1 }] },
    } as any;
    const res = mockRes();

    await OrderController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(OrderModel.create).not.toHaveBeenCalled();
  });

  test('库存不足时返回 400 且不创建订单', async () => {
    ProductModel.findById.mockResolvedValue({ ...PRODUCT, stock: 1 });

    const req = {
      userId: 7,
      body: { items: [{ product_id: 1, quantity: 5 }] },
    } as any;
    const res = mockRes();

    await OrderController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(OrderModel.create).not.toHaveBeenCalled();
    expect(ProductModel.decrStock).not.toHaveBeenCalled();
  });
});

describe('getDetail 订单详情', () => {
  test('订单不存在返回 404', async () => {
    OrderModel.findById.mockResolvedValue(null);

    const req = { userId: 7, params: { id: '999' } } as any;
    const res = mockRes();

    await OrderController.getDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('查看他人订单返回 403', async () => {
    OrderModel.findById.mockResolvedValue({ order_id: 1, user_id: 8 });

    const req = { userId: 7, params: { id: '1' } } as any;
    const res = mockRes();

    await OrderController.getDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(OrderModel.getOrderItems).not.toHaveBeenCalled();
  });
});
