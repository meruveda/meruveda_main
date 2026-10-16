import app from './app';
import { config } from './config/env';
import { reviewJobService } from './services/reviewJobService';
import { auditInvoiceSchemaAtBoot } from './services/invoiceSchemaGuard';

const PORT = config.port || 5000;

// The invoice pipeline degrades quietly when its migration is missing, which is
// how it shipped broken: no invoice, no error recorded, admin shows "Order not
// found". Audit at boot so the mismatch is visible immediately.
auditInvoiceSchemaAtBoot().catch((err) => {
  console.error('[InvoiceSchema] boot audit failed:', err?.message || err);
});

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
