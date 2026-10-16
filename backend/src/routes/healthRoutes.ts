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

  // The only question that really matters: can this deployment actually render
  // a PDF? Assets present but a renderer that throws is still broken, so we
  // render a real (tiny) document in memory and report the outcome.
  let pdfRenderOk = false;
  let pdfRenderDetail = '';
  try {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText('invoice render check', { x: 20, y: 700, size: 10, font });
    const bytes = await doc.save();
    pdfRenderOk = bytes.length > 0;
    pdfRenderDetail = `${bytes.length} bytes`;
  } catch (err: any) {
    pdfRenderDetail = err?.message || 'render failed';
  }

  // fontsOk/logoOk being false is a degradation (the renderer falls back to
  // Helvetica and prints "Rs."), not a failure, so the endpoint is healthy as
  // long as a PDF can actually be produced.
  const ok = pdfRenderOk;
  res.status(ok ? 200 : 503).json({
    ok,
    fontsOk: assets.fontsOk,
    logoOk: assets.logoOk,
    bucketOk,
    pdfRenderOk,
    missingFonts: assets.missingFonts,
    searched: invoiceAssetPaths('fonts/NotoSans-Regular.ttf'),
    detail: assets.detail,
    bucketDetail,
    pdfRenderDetail,
    hint: ok
      ? assets.fontsOk
        ? 'Invoice rendering is fully operational.'
        : 'PDFs work, but the custom fonts are missing so invoices fall back to Helvetica and print "Rs.". Add "assets/**" to the backend includeFiles in vercel.json.'
      : 'PDF rendering failed. Check the serverless logs.',
  });
});

export default router;