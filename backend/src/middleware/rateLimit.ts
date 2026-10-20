import { Request, Response, NextFunction } from 'express';
import { Redis } from '@upstash/redis';
import { config } from '../config/env';

/**
 * Pluggable rate limiter for a serverless deployment (Vercel).
 *
 * Store selection:
 *   - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set  -> Upstash Redis
 *     (REST-based, safe across serverless instances). This is the ONLY store
 *     that actually enforces limits across concurrent cold starts.
 *   - otherwise (dev, or prod misconfiguration)             -> in-process Map.
 *     A LOUD warning is logged at startup in production because per-instance
 *     limits are trivially bypassed by retrying until a different instance
 *     handles the request.
 *
 * Algorithm: fixed window per key — `INCR`, then `PEXPIRE` on first hit.
 * On limit, respond 429 + Retry-After (seconds until window reset).
 *
 * Keys combine the caller IP (from X-Forwarded-For via `trust proxy`) with an
 * optional secondary discriminator (e.g. the phone number in the body) so one
 * abusive IP cannot lock out every phone, and one abusive phone cannot exhaust
 * a whole IP's bucket.
 */

export interface RateLimitStore {
  /** Atomically increment `key`; returns the count after increment and the ms until the window resets. */
  incr(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }>;
}

// ---------------------------------------------------------------------------
// In-memory store (dev fallback only)
// ---------------------------------------------------------------------------
type Bucket = { count: number; resetAt: number };

export class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();
  private static readonly MAX_BUCKETS = 50_000;
  async incr(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }> {
    const now = Date.now();
    if (this.buckets.size > MemoryStore.MAX_BUCKETS) {
      for (const [k, b] of this.buckets) {
        if (now > b.resetAt) this.buckets.delete(k);
      }
    }
    let bucket = this.buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { count: bucket.count, resetInMs: Math.max(0, bucket.resetAt - now) };
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis store (production — shared across serverless instances)
// ---------------------------------------------------------------------------
export class UpstashStore implements RateLimitStore {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  async incr(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      // First hit in this window — set the TTL. A tiny race here (crash
      // between INCR and PEXPIRE) leaves a key without TTL; the memory
      // sweep in MemoryStore has no equivalent, so compensate: if PTTL is
      // -1 (no expiry), re-apply it.
      await this.redis.pexpire(key, windowMs);
    }
    let ttl = await this.redis.pttl(key);
    if (ttl === -1) {
      await this.redis.pexpire(key, windowMs);
      ttl = windowMs;
    }
    return { count, resetInMs: Math.max(0, ttl) };
  }
}

// ---------------------------------------------------------------------------
// Default store
// ---------------------------------------------------------------------------
function buildDefaultStore(): RateLimitStore {
  const url = config.upstashRedisRestUrl;
  const token = config.upstashRedisRestToken;
  if (url && token) {
    console.log('[rateLimit] using Upstash Redis store (limits enforced across instances).');
    return new UpstashStore(url, token);
  }
  if (config.nodeEnv === 'production') {
    console.warn(
      '\n⚠️  [rateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set.\n' +
        '   Rate limits are per-instance only and WILL NOT hold across Vercel\n' +
        '   serverless instances. Set both vars (Upstash console → REST API)\n' +
        '   before production traffic.\n',
    );
  }
  return new MemoryStore();
}

const defaultStore: RateLimitStore = buildDefaultStore();

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  prefix: string;
  store?: RateLimitStore;
  /**
   * Extra key segment appended to the IP-based key. Default behaviour keys on
   * the last 10 digits of req.body.phone, which is right for the public auth
   * endpoints. Endpoints without a phone in the body (e.g. admin-triggered
   * resets) pass their own segment — the admin user id, say — so one operator
   * cannot exhaust the limit for everyone else behind the same NAT/proxy.
   */
  secondaryKey?: (req: Request) => string;
  /**
   * Which single dimension the bucket is keyed on.
   *
   * 'composite' (default) keeps the existing ip+phone key.
   * 'phone' keys on the phone number alone, so rotating source IPs cannot
   *   bypass the limit — this is what stops one victim's number being flooded.
   * 'ip' keys on the IP alone, so one host cannot brute-force many numbers.
   * 'global' keys on a single fixed bucket for the whole deployment — used for
   *   cross-account caps (e.g. a daily OTP send ceiling) where the intent is
   *   "nobody, from anywhere, may exceed N per window".
   *
   * The OTP routes mount all three in series, giving a genuine per-phone AND
   * per-IP limit rather than one combined bucket.
   */
  keyMode?: 'composite' | 'phone' | 'ip' | 'global';
}) {
  const store = opts.store || defaultStore;
  const mode = opts.keyMode || 'composite';
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // req.ip honours `trust proxy` (X-Forwarded-For) — on Vercel this is
      // the real client IP, not the edge proxy's address.
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 45);
      const phone = opts.secondaryKey
        ? String(opts.secondaryKey(req) || '')
            .replace(/\D/g, '')
            .slice(-10)
        : String(req.body?.phone || '')
            .replace(/\D/g, '')
            .slice(-10);
      const key =
        mode === 'phone'
          ? `rl:${opts.prefix}:phone:${phone}`
          : mode === 'ip'
            ? `rl:${opts.prefix}:ip:${ip}`
            : mode === 'global'
              ? `rl:${opts.prefix}:global`
              : `rl:${opts.prefix}:${ip}:${phone}`;

      const { count, resetInMs } = await store.incr(key, opts.windowMs);

      if (count > opts.max) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(resetInMs / 1000))));
        return res.status(429).json({
          error: { message: 'Too many attempts. Please try again in a few minutes.' },
        });
      }
      next();
    } catch (err) {
      // Store outage must never take the API down — fail open (allow) but
      // make the failure visible.
      console.error('[rateLimit] store error, allowing request:', err);
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Pre-configured limiters, mounted in the route files.
// ---------------------------------------------------------------------------
export const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, prefix: 'login' });
export const signupLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, prefix: 'signup' });
export const otpSendLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5, prefix: 'otp-send' });
export const otpVerifyLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, prefix: 'otp-verify' });

/**
 * Per-PHONE and per-IP OTP limits, mounted alongside the composite bucket.
 *
 * The composite key alone is not enough in either direction: an attacker who
 * rotates source IPs has an unlimited quota for one victim number, and one host
 * can spray many numbers. These two buckets close each gap independently.
 *
 * Per-phone is the tighter of the two on purpose — a customer legitimately
 * re-requests a code a handful of times, an attacker flooding one number is not.
 */
export const otpSendPerPhoneLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  prefix: 'otp-send-phone',
  keyMode: 'phone',
});
export const otpSendPerIpLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  prefix: 'otp-send-ip',
  keyMode: 'ip',
});
export const otpVerifyPerPhoneLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  prefix: 'otp-verify-phone',
  keyMode: 'phone',
});
export const otpVerifyPerIpLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  prefix: 'otp-verify-ip',
  keyMode: 'ip',
});
export const passwordResetLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, prefix: 'pw-reset' });
export const orderCreateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, prefix: 'order-create' });
export const payuInitiateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, prefix: 'payu-initiate' });
// Images come in bursts from srcset (one product page = many widths), so this
// is deliberately more generous than the auth limiters.
export const imageProxyLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 120, prefix: 'img-proxy' });
// Admin-triggered resets: keyed by IP AND admin user id (createRateLimiter adds
// the phone/id segment when passed), so one support agent cannot spray reset
// emails at every account.
export const adminResetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  prefix: 'admin-pw-reset',
  secondaryKey: (req) => String(req.user?.id || 'anon-admin'),
});

// ---------------------------------------------------------------------------
// OTP abuse caps layered on top of the per-phone/per-IP buckets above.
// ---------------------------------------------------------------------------
// Hard 30s cooldown per number: a resend burst only wastes WhatsApp quota and
// trains users to hammer the button.
export const otpCooldownPerPhoneLimiter = createRateLimiter({
  windowMs: 30_000,
  max: 1,
  prefix: 'otp-cooldown',
  keyMode: 'phone',
});
// Per-number hourly ceiling (5/hour): the existing 10-minute bucket allows
// 5 sends in a tight burst, this one bounds the hour.
export const otpHourlyPerPhoneLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  prefix: 'otp-hourly',
  keyMode: 'phone',
});
// Deployment-wide daily ceiling across ALL numbers: one compromised config or
// a misbehaving client cannot drain the WhatsApp/OTP budget overnight.
export const otpGlobalDailyLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: Number(process.env.OTP_DAILY_SEND_CAP || '500') || 500,
  prefix: 'otp-daily',
  keyMode: 'global',
});

// Public coupon validation: the endpoint echoes per-code errors, so it is a
// cheap oracle for brute-forcing active codes.
export const couponValidateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  prefix: 'coupon-validate',
});
// Public AWB tracking proxies Shiprocket (authenticated, rate-limited upstream).
export const trackAwbLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  prefix: 'track-awb',
});

/**
 * Guest invoice download.
 *
 * The endpoint needs the order number AND the matching mobile number, so it
 * is not a free document fetcher - but a guessable order reference should
 * still not be able to hammer the PDF renderer.
 */
export const trackInvoiceLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  prefix: 'track-invoice',
});

/**
 * Guest checkout (no OTP).
 *
 * A number may place a few orders an hour and an IP a few more, so a guest
 * session cannot be used to flood the store (and to farm invoice numbers).
 */
export const guestPerNumberLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 3,
  prefix: 'guest-phone',
  keyMode: 'phone',
});

export const guestPerIpLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 10,
  prefix: 'guest-ip',
  keyMode: 'ip',
});
