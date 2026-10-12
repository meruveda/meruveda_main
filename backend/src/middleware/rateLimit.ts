import { Request, Response, NextFunction } from 'express';

/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * No external dependency (express-rate-limit is not in package.json and we
 * avoid adding one for two low-traffic endpoints). State is per-process —
 * fine on a single Vercel serverless instance; a multi-instance deployment
 * would need a shared store, which is out of scope here.
 *
 * Keys combine the caller IP with an optional secondary discriminator
 * (e.g. the mobile number on the request body) so one abusive IP cannot
 * lock out every phone, and one abusive phone cannot exhaust the whole IP.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

function sweep(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}

export function createRateLimiter(opts: { windowMs: number; max: number; prefix: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);

    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 45);
    // Secondary key: last 10 digits of phone when present (quick-login), else ''.
    const phone = String(req.body?.phone || '')
      .replace(/\D/g, '')
      .slice(-10);
    const key = `${opts.prefix}:${ip}:${phone}`;

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({
        error: { message: 'Too many attempts. Please try again in a few minutes.' },
      });
    }
    next();
  };
}
