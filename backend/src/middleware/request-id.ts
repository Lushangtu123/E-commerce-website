/**
 * 请求 ID 中间件
 * 沿用网关/上游传来的 X-Request-Id（格式合法时），否则生成 UUID；写回响应头，
 * 并在该请求的异步调用链中可通过 currentRequestId() 读取，日志自动带上。
 */
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { runWithRequestId } from '../utils/request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';
// 只接受短的可打印标识，防止日志注入和超长头
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  runWithRequestId(id, next);
}
