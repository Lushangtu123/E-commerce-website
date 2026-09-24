/**
 * 前端日志工具
 *
 * - 开发环境：全部输出到 console，方便调试
 * - 生产环境：仅保留 error（线上排查的最低限度信号），其余静默
 *
 * 后续如需上报到日志服务（如 Sentry），只需在这里扩展 error 方法。
 */
const isDev = process.env.NODE_ENV === 'development';

type LogArgs = unknown[];

export const logger = {
  error: (...args: LogArgs): void => {
    console.error(...args);
  },
  warn: (...args: LogArgs): void => {
    if (isDev) console.warn(...args);
  },
  info: (...args: LogArgs): void => {
    if (isDev) console.info(...args);
  },
  log: (...args: LogArgs): void => {
    if (isDev) console.log(...args);
  },
  debug: (...args: LogArgs): void => {
    if (isDev) console.debug(...args);
  },
};

export default logger;
