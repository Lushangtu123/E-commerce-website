/**
 * 前端日志工具
 *
 * - 开发环境：全部输出到 console，方便调试
 * - 生产环境：仅保留 error（线上排查的最低限度信号），其余静默
 *
 * 配置 NEXT_PUBLIC_SENTRY_DSN 后，lib/error-reporting.ts 加载完成时通过 setErrorReporter 接管 error 上报；
 * 未配置时不加载 Sentry，也不增加页面体积。
 */

const isDev = process.env.NODE_ENV === 'development';

type LogArgs = unknown[];

let reportError: ((args: LogArgs) => void) | null = null;

/** lib/error-reporting.ts installs Sentry here once it has loaded. */
export function setErrorReporter(reporter: ((args: LogArgs) => void) | null): void {
  reportError = reporter;
}

export const logger = {
  error: (...args: LogArgs): void => {
    console.error(...args);
    reportError?.(args);
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
