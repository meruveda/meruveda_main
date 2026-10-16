import { Router } from 'express';
import { checkInvoiceAssets, invoiceAssetPaths } from '../services/invoiceAssets';
import { ensureInvoiceBucket } from '../services/invoiceStore';

const router = Router();

/**
 * Public, secret-free self-test for the invoice runtime.
 *
 * The single most common production failure is a missing asset: on a serverless
 * bundle the fonts and the logo are not part of the traced dependency graph, so
 * the renderer silently degraded to Helvetica and could not draw ₹. This
 * endpoint answers the only question that matters — "are the assets actually
 * there?" — without exposing anything and without touching a secret, so you can
 * just open it in a browser.
 *
 *   GET /api/health/invoice
 *
 *   { ok, fontsOk, logoOk, bucketOk, fonts: [...], detail }
 */
router.get('/invoice', async (_req, res) => {
  const assets = checkInvoiceAssets();
  let bucketOk = false;
  let bucketDetail = '';
  try {
    bucketOk = await ensureInvoiceBucket();
    bucketDetail = bucketOk ? 'private bucket available' : 'bucket unavailable';
  } catch (err: any) {
    bucketDetail = err?.message || 'bucket probe failed';
  }

  const ok = assets.fontsOk && assets.logoOk && bucketOk;
  res.status(ok ? 200 : 503).json({
    ok,
    fontsOk: assets.fontsOk,
    logoOk: assets.logoOk,
    bucketOk,
    missingFonts: assets.missingFonts,
    searched: invoiceAssetPaths('fonts/NotoSans-Regular.ttf'),
    detail: assets.detail,
    bucketDetail,
    hint: ok
      ? 'Invoice rendering is fully operational.'
      : 'Invoice rendering is degraded. If fontsOk is false, add "assets/**" to the backend function includeFiles in vercel.json and redeploy.',
  });
});

export default router;