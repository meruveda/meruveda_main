import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload, isGuestScope, isCustomerScope } from '../utils/jwt';
import { resolveCustomerSession, resolveSessionFromRequest, type ResolvedCustomerSession } from '../services/customerSessionService';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      /** The checkout-created customer session, when there is one. */
      customerSession?: ResolvedCustomerSession;
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
 * A REAL account only - not a guest session and not a checkout session.
 *
 * The cart and the wishlist belong to a real account: they are stored in the
 * database against the user id. A checkout session has no account to own
 * them (and the storefront keeps them in localStorage), so it is refused
 * here. The answer is the same GUEST_SCOPE code the storefront already knows
 * how to ignore silently, so the cart never breaks for a session.
 */
export const requireRealAccount = (req: Request, res: Response, next: NextFunction) => {
  if (isGuestScope(req.user) || isCustomerScope(req.user)) {
    return res.status(401).json({
      error: { message: 'This session may only place an order. Please sign in to see your account.' },
      code: 'GUEST_SCOPE',
    });
  }
  next();
};

/**
 * The customer session.
 *
 * Two kinds of session may open the profile area:
 *   - a full session (the normal login), and
 *   - a checkout session (created at the contact step, scoped to what it
 *     created).
 *
 * A guest session (the old checkout-only session) is NOT enough, and neither
 * is no session at all.
 */
export const requireCustomerSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    /**
     * The httpOnly cookie is the primary carrier of the session: the page's
     * JavaScript cannot read it, so a cross-site script cannot steal it. A
     * Bearer token is still accepted (non-browser clients, the admin app).
     */
    const session = await resolveSessionFromRequest(req as any);
    if (session) {
      req.customerSession = session;
      req.user = {
        id: session.userId || session.id,
        email: session.email || '',
        role: 'customer',
        phone_verified: session.phoneVerified,
        scope: 'customer',
        sid: session.id,
      };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Unauthorized - No token provided' } });
    }
    const payload = verifyToken(authHeader.split(' ')[1]);
    req.user = payload;

    if (isCustomerScope(payload) && payload.sid) {
      const resolved = await resolveCustomerSession(payload.sid);
      if (!resolved) {
        return res.status(401).json({ error: { message: 'Your session has expired.', code: 'SESSION_EXPIRED' } });
      }
      req.customerSession = resolved;
      return next();
    }

    if (isGuestScope(payload)) {
      return res.status(401).json({
        error: { message: 'This session may only place an order. Please sign in to see your account.' },
        code: 'GUEST_SCOPE',
      });
    }

    // A full (verified) session: the account area is open, but the session
    // object is built from the user so the scoping code below is the same.
    req.customerSession = {
      id: `user:${payload.id}`,
      userId: payload.id,
      phone: '',
      name: null,
      email: payload.email,
      phoneVerified: payload.phone_verified !== false,
      verifiedAccount: true,
      createdAt: new Date().toISOString(),
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: { message: 'Unauthorized - Invalid token' } });
  }
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
