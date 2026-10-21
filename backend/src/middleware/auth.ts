import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload, isGuestScope } from '../utils/jwt';

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
 * Reject a checkout-only guest session.
 *
 * A guest session exists so somebody can place an order without proving they
 * own the number. Everything that reads EXISTING account data - the order
 * history (it embeds full shipping addresses and phone numbers), the address
 * book, the cart, the wishlist, the profile and the preferences - is closed
 * to it. Without this, a guest who typed somebody else's phone number would
 * be able to read that account.
 *
 * The answer is 401 with the code GUEST_SCOPE, not an opaque 403: the
 * storefront recognises the code, keeps the visitor's local cart and shows no
 * error at all. A 401 would otherwise look like an expired session.
 */
export const requireFullAuth = (req: Request, res: Response, next: NextFunction) => {
  if (isGuestScope(req.user)) {
    return res.status(401).json({
      error: { message: 'This session may only place an order. Please sign in to see your account.' },
      code: 'GUEST_SCOPE',
    });
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
