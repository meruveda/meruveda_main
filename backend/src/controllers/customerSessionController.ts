import { Request, Response, NextFunction } from 'express';
import { openCustomerSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, resolveCustomerSession, resolveSessionFromRequest } from '../services/customerSessionService';
import * as sessionsRepo from '../database/repos/customerSessions';
import * as usersRepo from '../database/repos/users';
import { isValidEmail } from '../utils/phone';

/**
 * The cookie that carries the customer session.
 *
 * httpOnly (the page cannot read it), SameSite=Lax (it is not sent on
 * cross-site POSTs) and Secure in production. 90 days, and it is ROTATED on
 * every use of the Continue button.
 */
function setSessionCookie(res: Response, token: string) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

/**
 * POST /api/account/session - the "Continue" button of the checkout.
 *
 * Creates the customer profile if the number is new, opens the session and
 * answers with the profile of THIS session. The answer never says whether
 * the number already existed.
 */
export const createSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await openCustomerSession({
      name: req.body?.name,
      phone: req.body?.phone,
      email: req.body?.email,
      website: req.body?.website,
      renderedAt: req.body?.renderedAt,
    });

    if (!result.ok) {
      return res.status(result.status).json({
        error: { message: result.message, ...(result.silent ? { silent: true } : {}) },
      });
    }

    setSessionCookie(res, result.token);

    res.status(201).json({
      data: {
        profile: result.profile,
        session: { id: result.sessionId, expiresInDays: 90 },
        token: result.token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/account/session - "is there a session, and whose profile is it?"
 *
 * The storefront asks on every page load to decide whether to show the
 * account icon. 401 means "no session" - that is not an error.
 */
export const getSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    /**
     * The httpOnly cookie is the carrier: the page cannot read it, so it
     * cannot leak it. A Bearer token is still accepted for non-browser
     * clients.
     */
    const session = await resolveSessionFromRequest(req as any);
    if (!session) {
      /**
       * "Is there a session?" is a QUESTION, not a failure.
       *
       * A visitor without a session gets 200 with a null profile. A 401 here
       * would look like an expired session to the storefront's HTTP layer,
       * which would wipe the session and RELOAD the page - an endless reload
       * loop on every page.
       */
      return res.json({ data: { profile: null } });
    }
    res.json({
      data: {
        profile: {
          name: session.name,
          phone: session.phone,
          email: session.email,
          phoneVerified: session.phoneVerified,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/account/session/logout - clear the session.
 *
 * The cookie is removed and the token is dropped. The orders stay in the
 * database: they belong to the customer, not to the browser.
 */
export const logoutSession = async (_req: Request, res: Response) => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : ''
    }`,
  );
  res.json({ data: { ok: true } });
};

/**
 * GET /api/account/profile - the profile of THIS session.
 *
 * It is the profile the customer created at the checkout - never the profile
 * of an account that happened to own the same number.
 */
export const getProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.customerSession;
    if (!session) {
      return res.status(401).json({ error: { message: 'No session', code: 'NO_SESSION' } });
    }
    res.json({
      data: {
        profile: {
          name: session.name || '',
          phone: session.phone || '',
          email: session.email || '',
          phoneVerified: session.phoneVerified,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/account/profile - edit the name and the email.
 *
 * The PHONE is read-only on purpose: it is the identity of the session, and
 * changing it would move the session to another customer's data.
 */
export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.customerSession;
    if (!session || !session.id || session.id.startsWith('user:')) {
      return res.status(401).json({ error: { message: 'No session', code: 'NO_SESSION' } });
    }

    const patch: Record<string, any> = {};

    const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
    if (name) {
      if (name.length < 2) {
        return res.status(400).json({ error: { message: 'Please enter your full name.' } });
      }
      if (name.length > 120) {
        return res.status(400).json({ error: { message: 'That name is too long.' } });
      }
      patch.name = name;
    }

    if (req.body?.email !== undefined) {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: { message: 'Please enter your email address.' } });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: { message: 'Please enter a valid email address.' } });
      }
      patch.email = email;
    }

    if (Object.keys(patch).length > 0) {
      await sessionsRepo.updateSession(session.id, patch);
      // The profile row of a session that HAS a customer is kept in step.
      if (session.userId) {
        const userPatch: Record<string, any> = { updated_at: new Date().toISOString() };
        if (patch.name) {
          const parts = patch.name.split(/\s+/);
          userPatch.first_name = parts[0];
          userPatch.last_name = parts.slice(1).join(' ') || null;
        }
        if (patch.email) {
          const owner = await usersRepo.findByEmail(patch.email, 'id').catch(() => null);
          if (!owner || owner.id === session.userId) userPatch.email = patch.email;
        }
        await usersRepo.updateUserReturning(session.userId, userPatch, 'id').catch(() => null);
      }
    }

    res.json({
      data: {
        profile: {
          name: patch.name ?? session.name ?? '',
          phone: session.phone || '',
          email: patch.email ?? session.email ?? '',
          phoneVerified: session.phoneVerified,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
