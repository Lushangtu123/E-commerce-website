jest.mock('../../utils/error-reporting', () => ({ reportLoggedError: jest.fn() }));

import logger from '../../utils/logger';
import { reportLoggedError } from '../../utils/error-reporting';

// Jest runs with LOG_LEVEL=silent; pino only calls the hook for enabled levels, as in production.
beforeEach(() => { jest.clearAllMocks(); logger.level = 'info'; });
afterAll(() => { logger.level = 'silent'; });

test('error 和 fatal 日志交给错误上报，并传入原始参数', () => {
  const err = new Error('boom');
  logger.error({ err }, '处理失败');
  logger.fatal('无法启动');
  expect(reportLoggedError).toHaveBeenNthCalledWith(1, [{ err }, '处理失败']);
  expect(reportLoggedError).toHaveBeenNthCalledWith(2, ['无法启动']);
});

test('warn 及以下的日志不上报', () => {
  logger.warn({ err: new Error('slow') }, '慢查询');
  logger.info('启动完成');
  expect(reportLoggedError).not.toHaveBeenCalled();
});
