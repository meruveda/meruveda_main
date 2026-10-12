import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Unauthorized - No token provided' } });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: { message: 'Unauthorized - Invalid token' } });
  }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: { message: 'Forbidden - Requires admin privileges' } });
  }
  next();
};

/**
 * For routes that are public by default but need to know *who* is asking when a
 * token happens to be present (e.g. GET /settings returns a wider payload to
 * admins). Never rejects: a missing or malformed token simply leaves req.user unset.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      req.user = verifyToken(header.split(' ')[1]);
    }
  } catch {
    req.user = undefined;
  }
  next();
};
