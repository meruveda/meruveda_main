import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env';
import { isOriginAllowed } from './config/corsOrigins';

const app = express();
const allowedOriginSet = new Set(config.allowedOrigins);

// Behind Vercel / reverse proxies the original scheme arrives via
// X-Forwarded-Proto. Trust it so req.protocol is https in production —
// otherwise PayU surl/furl are generated as http:// and the customer's
// browser warns about insecure submission (and callbacks can break).
// Hop count is env-driven (default 1 = Vercel's edge) so req.ip — which the
// rate limiter keys on — is the real client IP from X-Forwarded-For.
app.set('trust proxy', config.trustProxyHops);

// Middleware
app.use(helmet());
app.use(cors({
  // Explicit allowlist — never '*'. Denials send no CORS headers at all
  // (callback(null,false)); they are not server errors.
  origin: (origin, callback) => {
    callback(null, isOriginAllowed(origin, allowedOriginSet, config.nodeEnv));
  },
  credentials: true
}));
app.use(morgan('dev'));
// Capture the raw body for webhook signature verification (WhatsApp
// X-Hub-Signature-256 needs the exact bytes Meta signed).
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));

import { query as dbQuery } from './database/db';

// Root Route
app.get('/', (req, res) => {
  res.json({
    status: "online",
    service: "MeruVeda Backend",
    version: "1.0.0"
  });
});

// Postgres/Neon errors can embed the full connection string (credentials
// included). Never return or log that: redact it first.
const CONNECTION_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"')]+/gi;
function redactSecrets(value: unknown): string {
  return String(value ?? '')
    .replace(CONNECTION_URL_PATTERN, 'postgresql://[redacted]')
    .replace(/(connection string:\s*).*/gi, '$1[redacted]');
}

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    await dbQuery('SELECT 1 AS ok');
    res.status(200).json({
      status: 'online',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[health] database check failed:', redactSecrets(err?.message || err));
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: 'Database unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

// Deep health: schema drift vs expected-schema.json, both R2 buckets, env
// names (names only), Shiprocket auth, WhatsApp Graph auth, and the
// Shiprocket/invoice queues. Authenticated (CRON_SECRET bearer or admin JWT)
// so it is not a public oracle for internal state. Read-only: no writes, no
// messages, one Shiprocket login at most.
import { authorize } from './routes/jobRoutes';
import { runDeepHealth } from './services/healthDeep';
import { warmUp } from './controllers/warmupController';

/**
 * Warm the backend so the storefront's server-side fetch never races a cold
 * start. It touches the database and the products query - the two things the
 * public pages read - and exposes nothing.
 */
app.get('/api/warmup', warmUp as any);

app.get('/api/health/deep', authorize, async (_req, res) => {
  try {
    const report = await runDeepHealth();
    res.status(report.status === 'error' ? 503 : 200).json(report);
  } catch (err: any) {
    console.error('[health/deep] probe failed:', redactSecrets(err?.message || err));
    res.status(503).json({ status: 'error', error: 'Deep health probe failed' });
  }
});

import authRoutes from './routes/authRoutes';
import healthRoutes from './routes/healthRoutes';
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import cartRoutes from './routes/cartRoutes';
import wishlistRoutes from './routes/wishlistRoutes';
import addressRoutes from './routes/addressRoutes';
import categoryRoutes from './routes/categoryRoutes';
import settingsRoutes from './routes/settingsRoutes';

import customerRoutes from './routes/customerRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import mediaRoutes from './routes/mediaRoutes';
import notificationRoutes from './routes/notificationRoutes';
import activityLogRoutes from './routes/activityLogRoutes';
import transactionRoutes from './routes/transactionRoutes';
import supportRoutes from './routes/supportRoutes';
import couponRoutes from './routes/couponRoutes';
import reviewRoutes from './routes/reviewRoutes';
import blogRoutes from './routes/blogRoutes';
import shiprocketRoutes from './routes/shiprocketRoutes';
import bannerRoutes from './routes/bannerRoutes';
import payuRoutes from './routes/payuRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import jobRoutes from './routes/jobRoutes';
import logisticsRoutes from './routes/logisticsRoutes';
import imageRoutes from './routes/imageRoutes';
import path from 'path';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/shiprocket', shiprocketRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/payu', payuRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/images', imageRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(redactSecrets(err?.stack || err?.message || err));
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: redactSecrets(err.message || 'Internal Server Error'),
      ...(process.env.NODE_ENV === 'development' && { stack: redactSecrets(err.stack) })
    }
  });
});

export default app;
