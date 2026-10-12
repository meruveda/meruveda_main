import app from './app';
import { config } from './config/env';
import { reviewJobService } from './services/reviewJobService';

const PORT = config.port || 5000;

// On Vercel the framework runtime imports the exported app directly —
// never call listen() there, only in local/standalone deployments.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Backend server is running on http://localhost:${PORT}`);
    console.log(`Environment: ${config.nodeEnv}`);
  });
}

export default app;

// ---------------------------------------------------------------------------
// Local development scheduler.
// In production Vercel Cron calls GET /api/jobs/review-requests (see
// `crons` in vercel.json). Locally we replicate that schedule here so the
// 7-day review request job behaves the same way without a deployment.
// ---------------------------------------------------------------------------
if (config.nodeEnv !== 'production') {
  const EVERY_6_HOURS = 6 * 60 * 60 * 1000;
  const runReviewJob = async () => {
    try {
      const stats = await reviewJobService.process();
      if (stats.scanned > 0) {
        console.log('[ReviewJob] processed:', stats);
      }
    } catch (err: any) {
      console.error('[ReviewJob] run failed:', err?.message || err);
    }
  };

  setTimeout(runReviewJob, 30_000); // first pass shortly after boot
  setInterval(runReviewJob, EVERY_6_HOURS);
}
