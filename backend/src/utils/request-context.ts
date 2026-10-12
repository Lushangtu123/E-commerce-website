/**
 * 请求上下文：在一次 HTTP 请求的整个异步调用链中保存请求 ID，
 * 让 service / model 里的日志不需要逐层传参也能带上 requestId。
 */
import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** pino mixin：请求内的每条日志附带 requestId，请求外不加字段 */
export function logContext(): { requestId?: string } {
  const requestId = currentRequestId();
  return requestId ? { requestId } : {};
}
