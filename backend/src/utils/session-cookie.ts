import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export const CUSTOMER_COOKIE = 'customer_session';
export const ADMIN_COOKIE = 'admin_session';
/**
 * A cross-site form cannot set a custom header, and a cross-origin script that sets one is
 * stopped by the CORS preflight, so its presence proves the request came from an allowed page.
 */
export const CSRF_HEADER = 'X-Requested-With';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function cookieOptions(): CookieOptions {
  // The cookie only travels to the API, never to the pages around it.
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api' };
}

/** Reads one cookie from the request; a missing or malformed value reads as absent. */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Stores a signed session in an httpOnly cookie that expires together with the token. */
export function setSessionCookie(res: Response, name: string, token: string): void {
  const expiresAt = (jwt.decode(token) as jwt.JwtPayload | null)?.exp;
  res.cookie(name, token, { ...cookieOptions(), ...(expiresAt && { maxAge: Math.max(0, expiresAt * 1000 - Date.now()) }) });
}

export function clearSessionCookie(res: Response, name: string): void {
  res.clearCookie(name, cookieOptions());
}

/** True when an unsafe request carries the header that a cross-site page cannot send. */
export function hasCsrfHeader(req: Request): boolean {
  return SAFE_METHODS.has(req.method) || Boolean(req.get(CSRF_HEADER));
}

export type SessionToken =
  | { token: string; source: 'bearer' | 'cookie' }
  | { token?: undefined; source: 'none' }
  /** A session cookie arrived on an unsafe request without the CSRF header. */
  | { token?: undefined; source: 'forged' };

/**
 * The request's session token. An explicit Bearer header wins, so API clients and tests are
 * unaffected; otherwise the session cookie, which unsafe requests may only use with the CSRF header.
 */
export function sessionToken(req: Request, cookieName: string): SessionToken {
  const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (bearer) return { token: bearer, source: 'bearer' };
  const cookie = readCookie(req, cookieName);
  if (!cookie) return { source: 'none' };
  return hasCsrfHeader(req) ? { token: cookie, source: 'cookie' } : { source: 'forged' };
}

export const CSRF_ERROR = '请求来源校验失败，请刷新页面后重试';
