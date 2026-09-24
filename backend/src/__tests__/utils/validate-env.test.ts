/**
 * 启动环境变量校验测试
 */
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('../../utils/logger').default as {
  warn: jest.Mock;
  error: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateEnv, getCorsOrigins } = require('../../utils/validate-env') as {
  validateEnv: () => void;
  getCorsOrigins: () => string[] | true;
};

const OLD_ENV = { ...process.env };
let exitSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  delete process.env.JWT_SECRET;
  delete process.env.CORS_ORIGIN;
  exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
});

afterEach(() => {
  exitSpy.mockRestore();
  process.env = { ...OLD_ENV };
});

describe('getCorsOrigins', () => {
  test('未配置时返回 true（开发环境放行）', () => {
    expect(getCorsOrigins()).toBe(true);
  });

  test('单个域名', () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000';
    expect(getCorsOrigins()).toEqual(['http://localhost:3000']);
  });

  test('逗号分隔多个域名（自动去空格）', () => {
    process.env.CORS_ORIGIN = 'https://a.com, https://b.com ';
    expect(getCorsOrigins()).toEqual(['https://a.com', 'https://b.com']);
  });
});

describe('validateEnv', () => {
  test('开发环境缺失配置：只警告不退出', () => {
    process.env.NODE_ENV = 'development';
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('生产环境缺失 JWT_SECRET：拒绝启动', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://a.com';
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();
  });

  test('生产环境使用弱密钥：拒绝启动', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'secret';
    process.env.CORS_ORIGIN = 'https://a.com';
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('生产环境缺失 CORS_ORIGIN：拒绝启动', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-random-secret-value';
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('生产环境配置完整：正常启动', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-random-secret-value';
    process.env.CORS_ORIGIN = 'https://a.com';
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
