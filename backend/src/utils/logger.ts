/**
 * 统一日志
 *
 * - 生产环境：默认输出 JSON 到 stdout，由日志采集系统收集
 * - 开发环境：通过 pino-pretty 输出带颜色的可读日志
 * - 配置 LOG_FILE 后，同时写入该文件（JSON 格式，自动创建目录）
 *
 * 用法：
 *   import logger from '../utils/logger';
 *   logger.info('服务启动');
 *   logger.info({ port }, '服务启动');
 *   logger.error({ err }, '数据库连接失败');
 *
 * 环境变量：
 *   LOG_LEVEL   日志级别（默认开发环境 debug，生产环境 info）
 *   LOG_FILE    日志文件路径（可选）
 */
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const targets: pino.TransportTargetOptions[] = [];

// 开发环境：带颜色的可读输出
if (!isProduction) {
  targets.push({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  });
}

// 配置了 LOG_FILE 时，同时写入日志文件（JSON 格式）
if (process.env.LOG_FILE) {
  targets.push({
    target: 'pino/file',
    options: { destination: process.env.LOG_FILE, mkdir: true },
  });
}

// 有 target 时走 worker 线程 transport，否则直接输出到 stdout
const logger =
  targets.length > 0 ? pino({ level }, pino.transport({ targets })) : pino({ level });

export default logger;
