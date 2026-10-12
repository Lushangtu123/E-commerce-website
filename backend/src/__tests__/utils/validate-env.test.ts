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

  test.each(['secret', 'your_production_jwt_secret_key', 'your_super_secret_jwt_key_change_this_in_production'])('生产环境使用占位密钥 %s：拒绝启动', secret => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = secret;
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

describe('validateEnv 配置格式', () => {
  const FORMAT_KEYS = ['PORT', 'DB_PORT', 'REDIS_PORT', 'DB_CONNECTION_LIMIT', 'RATE_LIMIT_WINDOW', 'RATE_LIMIT_MAX',
    'RATE_LIMIT_AUTH_MAX', 'DB_SSL', 'REDIS_TLS', 'RATE_LIMIT_STORE', 'PAYMENT_MODE', 'EMAIL_PROVIDER', 'LOG_LEVEL',
    'REDIS_URL', 'RABBITMQ_URL', 'ELASTICSEARCH_URL', 'JWT_EXPIRES_IN', 'APP_URL', 'RESEND_API_KEY', 'EMAIL_FROM', 'SENTRY_DSN', 'SENTRY_ENVIRONMENT'];
  const logged = () => JSON.stringify([...logger.error.mock.calls, ...logger.warn.mock.calls]);

  beforeEach(() => {
    for (const key of FORMAT_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-random-secret-value';
    process.env.CORS_ORIGIN = 'https://a.com';
  });

  test('.env.example 中的取值都通过', () => {
    Object.assign(process.env, {
      PORT: '3001', DB_PORT: '3306', REDIS_PORT: '6379', DB_CONNECTION_LIMIT: '2', RATE_LIMIT_WINDOW: '60000',
      RATE_LIMIT_MAX: '100', RATE_LIMIT_AUTH_MAX: '10', DB_SSL: 'true', REDIS_TLS: 'false', RATE_LIMIT_STORE: 'redis',
      PAYMENT_MODE: 'disabled', EMAIL_PROVIDER: 'resend', LOG_LEVEL: 'info', JWT_EXPIRES_IN: '7d',
      REDIS_URL: 'rediss://default:password@your-endpoint.upstash.io:6379',
      RABBITMQ_URL: 'amqp://admin:admin123@localhost:5672', ELASTICSEARCH_URL: 'http://localhost:9200',
      SENTRY_DSN: 'https://publickey@o0.ingest.sentry.io/0', SENTRY_ENVIRONMENT: 'production',
    });
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('空字符串视为未配置', () => {
    for (const key of FORMAT_KEYS) process.env[key] = '';
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test.each([
    ['PORT', 'abc'], ['DB_PORT', '70000'], ['REDIS_PORT', '63 79'], ['DB_CONNECTION_LIMIT', '0'],
    ['RATE_LIMIT_WINDOW', '1m'], ['RATE_LIMIT_MAX', '-5'], ['RATE_LIMIT_AUTH_MAX', '2.5'],
    // 以前这些值会被静默当成 false，TLS 不启用
    ['DB_SSL', '1'], ['REDIS_TLS', 'TRUE'],
    ['RATE_LIMIT_STORE', 'redis-cluster'], ['PAYMENT_MODE', 'live'], ['EMAIL_PROVIDER', 'smtp'], ['LOG_LEVEL', 'verbose'],
    ['REDIS_URL', 'http://cache:6379'], ['RABBITMQ_URL', 'localhost:5672'], ['ELASTICSEARCH_URL', 'es:9200'],
    // jsonwebtoken 把不带单位的字符串当毫秒：3600 会变成 3.6 秒
    ['JWT_EXPIRES_IN', '3600'], ['JWT_EXPIRES_IN', 'forever'],
    ['SENTRY_DSN', 'not a dsn'], ['SENTRY_ENVIRONMENT', 'prod env'],
  ])('生产环境 %s=%s 格式错误：拒绝启动并指出变量名', (key, value) => {
    process.env[key] = value;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logged()).toContain(key);
  });

  test('一次报告所有格式错误', () => {
    Object.assign(process.env, { PORT: 'abc', DB_SSL: 'yes', LOG_LEVEL: 'loud' });
    validateEnv();
    expect(exitSpy).toHaveBeenCalledTimes(1);
    for (const key of ['PORT', 'DB_SSL', 'LOG_LEVEL']) expect(logged()).toContain(key);
  });

  test('日志不包含配置值（可能含密码）', () => {
    process.env.REDIS_URL = 'ftp://user:hunter2-secret@cache:6379';
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logged()).not.toContain('hunter2-secret');
  });

  test('开发环境格式错误：只警告不退出', () => {
    process.env.NODE_ENV = 'development';
    process.env.DB_SSL = '1';
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).toContain('DB_SSL');
  });

  test('配置了 APP_URL 但邮件配置不完整：提示找回密码邮件不可用，不阻止启动', () => {
    process.env.APP_URL = 'https://shop.example';
    process.env.RESEND_API_KEY = 're_test_key';
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).toContain('APP_URL');
  });

  test('邮件配置完整：不提示', () => {
    Object.assign(process.env, { APP_URL: 'https://shop.example', RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Store <shop@shop.example>' });
    validateEnv();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
