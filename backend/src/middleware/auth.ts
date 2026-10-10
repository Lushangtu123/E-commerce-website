import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model';
import { CSRF_ERROR, CUSTOMER_COOKIE, sessionToken } from '../utils/session-cookie';
import { jwtSecret } from '../utils/jwt-secret';

export interface AuthRequest extends Request {
  userId?: number;
  user?: any;
}

function userPayload(decoded: string | jwt.JwtPayload): decoded is jwt.JwtPayload {
  return typeof decoded === 'object' && decoded.type !== 'admin' &&
    (decoded.type === undefined || decoded.type === 'user') &&
    Number.isSafeInteger(decoded.userId) && decoded.userId > 0 &&
    (decoded.authVersion === undefined || (Number.isSafeInteger(decoded.authVersion) && decoded.authVersion >= 0));
}

/** An expected profile only constrains an already verified identity; it never authenticates. */
function matchesExpectedCustomer(req: Request, res: Response, userId: number): boolean {
  const expected = req.get('X-Expected-Customer-Id');
  if (expected === undefined) return true;
  if (!/^[1-9]\d*$/.test(expected) || !Number.isSafeInteger(Number(expected))) {
    res.status(400).json({ error: '请求格式无效' });
    return false;
  }
  if (Number(expected) !== userId) {
    res.status(409).json({ error: '登录状态已变化，请刷新后重试' });
    return false;
  }
  return true;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let decoded: jwt.JwtPayload;
  try {
    const { token, source } = sessionToken(req, CUSTOMER_COOKIE);
    if (source === 'forged') return res.status(403).json({ error: CSRF_ERROR });
    if (!token) {
      return res.status(401).json({ error: '未登录，请先登录' });
    }

    const verified = jwt.verify(token, jwtSecret());
    if (!userPayload(verified)) return res.status(401).json({ error: '无效的用户令牌' });
    decoded = verified;
  } catch (error) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  try {
    const version = await UserModel.getAuthVersion(decoded.userId);
    if (version === null || version !== (decoded.authVersion ?? 0)) return res.status(401).json({ error: '登录已过期，请重新登录' });
    if (!matchesExpectedCustomer(req, res, decoded.userId)) return;
    req.userId = decoded.userId;
    req.user = decoded;
    return next();
  } catch {
    return res.status(503).json({ error: '账户认证暂不可用，请稍后重试' });
  }
}

export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  delete req.userId;
  delete req.user;
  try {
    // A cookie on an unsafe request without the CSRF header reads as anonymous.
    const { token } = sessionToken(req, CUSTOMER_COOKIE);

    if (token) {
      const decoded = jwt.verify(token, jwtSecret()) as any;
      if (userPayload(decoded) && (await UserModel.getAuthVersion(decoded.userId)) === (decoded.authVersion ?? 0)) {
        if (!matchesExpectedCustomer(req, res, decoded.userId)) return;
        req.userId = decoded.userId;
        req.user = decoded;
      }
    }
    
  } catch (error) {
    // Anonymous browsing is allowed, but failures never grant an identity.
  }
  next();
}
