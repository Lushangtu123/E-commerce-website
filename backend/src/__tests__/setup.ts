/**
 * Jest 全局 setup：统一测试环境变量
 * 注意：各测试文件如需覆盖限流阈值，应在 import 被测模块之前设置，
 * 或使用 jest.resetModules() 后重新 require（见 rate-limit.test.ts）
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.LOG_LEVEL = 'silent';
