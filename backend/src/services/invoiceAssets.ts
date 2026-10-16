import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Where the invoice's binary assets live, and whether they are actually there.
 *
 * These files are read with `readFileSync` at request time, which puts them
 * outside any dependency graph a serverless bundler can trace. Locally
 * `copy-assets.cjs` copies them into `dist/`, but a deployed function runs from
 * a different output directory entirely — so on Vercel they were silently
 * missing, the renderer fell back to Helvetica/Courier, and it could not draw ₹.
 *
 * That is why the search list is deliberately wide and why `/health/invoice`
 * exposes the answer: guessing at paths in production is how the invoice looked
 * wrong for weeks.
 */

/** Every font the renderer needs, relative to the asset root. */
export const INVOICE_FONT_FILES = [
  'fonts/SourceSerif4-Bold.ttf',
  'fonts/NotoSans-Regular.ttf',
  'fonts/NotoSans-Bold.ttf',
  'fonts/NotoSansMono-Regular.ttf',
  'fonts/NotoSansMono-Bold.ttf',
] as const;

export const INVOICE_LOGO_FILE = 'meruveda-logo.png';

/**
 * Candidate roots, in priority order.
 *
 * `dist/assets` is what `copy-assets.cjs` produces and what a locally-run server
 * uses. The `/var/task` entries cover the Vercel function bundle, and
 * `process.cwd()` covers both `backend/` and `backend/dist/` working directories.
 */
export const INVOICE_ASSET_ROOTS: string[] = [
  path.resolve(__dirname, '../assets'),
  path.resolve(__dirname, '../../assets'),
  path.resolve(__dirname, '../../../backend/assets'),
  path.resolve(process.cwd(), 'assets'),
  path.resolve(process.cwd(), 'backend/assets'),
  path.resolve(process.cwd(), 'dist/assets'),
  path.resolve('/var/task/assets'),
  path.resolve('/var/task/backend/assets'),
  path.resolve('/var/task/backend/dist/assets'),
];

/** Absolute paths probed for one asset, in the order they are tried. */
export function invoiceAssetPaths(rel: string): string[] {
  return INVOICE_ASSET_ROOTS.map((root) => path.join(root, rel));
}

/** First readable copy of an asset, or null. */
export function readInvoiceAsset(rel: string): Buffer | null {
  for (const candidate of invoiceAssetPaths(rel)) {
    try {
      return readFileSync(candidate);
    } catch {
      /* try the next root */
    }
  }
  return null;
}

export interface AssetCheck {
  fontsOk: boolean;
  logoOk: boolean;
  missingFonts: string[];
  /** Human-readable summary, safe to log or return from a health endpoint. */
  detail: string;
}

/**
 * Check every asset the renderer needs, without throwing.
 *
 * Used by `/health/invoice` so the state of the deployed bundle is observable
 * from a browser instead of being guessed at from a broken invoice.
 */
export function checkInvoiceAssets(): AssetCheck {
  const missingFonts: string[] = [];
  let logoOk = false;

  for (const rel of INVOICE_FONT_FILES) {
    // Checked by readability across ALL roots, not by existence of the first
    // one: a single existsSync() on the first candidate reports "missing" for
    // every deployment, because the first candidate is the local dist/ path.
    if (!readInvoiceAsset(rel)) missingFonts.push(rel);
  }
  logoOk = Boolean(readInvoiceAsset(INVOICE_LOGO_FILE));

  const detail = `searched roots: ${INVOICE_ASSET_ROOTS.join(' | ')}`;
  return {
    fontsOk: missingFonts.length === 0,
    logoOk,
    missingFonts,
    detail,
  };
}