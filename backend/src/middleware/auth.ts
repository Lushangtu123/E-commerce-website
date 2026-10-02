import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: number;
  user?: any;
}

function userPayload(decoded: string | jwt.JwtPayload): decoded is jwt.JwtPayload {
  return typeof decoded === 'object' && decoded.type !== 'admin' &&
    Number.isSafeInteger(decoded.userId) && decoded.userId > 0;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: '未登录，请先登录' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    if (!userPayload(decoded)) return res.status(401).json({ error: '无效的用户令牌' });
    req.userId = decoded.userId;
    req.user = decoded;
    
    next();
  } catch (error) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
      if (userPayload(decoded)) {
        req.userId = decoded.userId;
        req.user = decoded;
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}
