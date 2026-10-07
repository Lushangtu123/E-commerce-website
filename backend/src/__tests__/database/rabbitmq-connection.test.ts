import { EventEmitter } from 'events';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

let amqp: { connect: jest.Mock };

function fakeConnection() {
  const conn: any = new EventEmitter();
  conn.createChannel = jest.fn().mockResolvedValue({ assertQueue: jest.fn().mockResolvedValue({}) });
  conn.close = jest.fn(async () => { conn.emit('close'); });
  return conn;
}

let rabbitmq: typeof import('../../database/rabbitmq');
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  jest.clearAllMocks();
  process.env.RABBITMQ_URL = 'amqp://localhost';
  amqp = require('amqplib');
  rabbitmq = require('../../database/rabbitmq');
});
afterEach(() => {
  jest.useRealTimers();
  delete process.env.RABBITMQ_URL;
});

test('未配置 RABBITMQ_URL 时跳过连接，不抛错', async () => {
  delete process.env.RABBITMQ_URL;
  const ready = jest.fn();
  await expect(rabbitmq.connectRabbitMQ(ready)).resolves.toBeUndefined();
  expect(amqp.connect).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  expect(rabbitmq.isRabbitMQConfigured()).toBe(false);
});

test('连接失败不抛错，并在后台重试', async () => {
  amqp.connect.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(fakeConnection());
  const ready = jest.fn().mockResolvedValue(undefined);
  await expect(rabbitmq.connectRabbitMQ(ready)).resolves.toBeUndefined();
  expect(() => rabbitmq.getChannel()).toThrow('未初始化');
  await jest.advanceTimersByTimeAsync(5000);
  expect(amqp.connect).toHaveBeenCalledTimes(2);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(() => rabbitmq.getChannel()).not.toThrow();
});

test('断开后清除旧 channel，重连成功后重新注册消费者', async () => {
  const first = fakeConnection();
  amqp.connect.mockResolvedValueOnce(first).mockResolvedValueOnce(fakeConnection());
  const ready = jest.fn().mockResolvedValue(undefined);
  await rabbitmq.connectRabbitMQ(ready);
  expect(ready).toHaveBeenCalledTimes(1);

  first.emit('close');
  expect(() => rabbitmq.getChannel()).toThrow('未初始化');
  await jest.advanceTimersByTimeAsync(5000);
  expect(ready).toHaveBeenCalledTimes(2);
  expect(() => rabbitmq.getChannel()).not.toThrow();
});

test('注册消费者失败时断开并重连', async () => {
  amqp.connect.mockResolvedValueOnce(fakeConnection()).mockResolvedValueOnce(fakeConnection());
  const ready = jest.fn().mockRejectedValueOnce(new Error('consume failed')).mockResolvedValueOnce(undefined);
  await expect(rabbitmq.connectRabbitMQ(ready)).resolves.toBeUndefined();
  expect(() => rabbitmq.getChannel()).toThrow('未初始化');
  await jest.advanceTimersByTimeAsync(5000);
  expect(ready).toHaveBeenCalledTimes(2);
  expect(() => rabbitmq.getChannel()).not.toThrow();
});

test('优雅关闭时不再重连', async () => {
  amqp.connect.mockResolvedValue(fakeConnection());
  await rabbitmq.connectRabbitMQ(jest.fn().mockResolvedValue(undefined));
  await rabbitmq.closeRabbitMQ();
  await jest.advanceTimersByTimeAsync(10000);
  expect(amqp.connect).toHaveBeenCalledTimes(1);
});
