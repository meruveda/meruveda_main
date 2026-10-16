/**
 * Extract the text a PDF actually draws.
 *
 * Why this exists rather than regexing the content stream: pdf-lib subsets
 * embedded fonts and emits the text as CID glyph indices into a custom
 * encoding, with the real Unicode reachable only through the font's ToUnicode
 * CMap. Hand-decoding `<hex> Tj` therefore yields glyph ids, not words — an
 * earlier version of this silently returned an empty string, which would have
 * made every "the template contains X" assertion pass vacuously.
 *
 * pdf.js resolves the CMap for us.
 */
export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  fontName: string;
}

export interface PageInfo {
  width: number;
  height: number;
  items: TextItem[];
  text: string;
}

async function getPdfjs() {
  // The legacy build works in Node without a DOM.
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return mod;
}

let cached: any = null;

export async function extractPdf(buf: Buffer | Uint8Array): Promise<PageInfo[]> {
  if (!cached) {
    const mod = await getPdfjs();
    cached = mod.getDocument
      ? mod
      : (mod.default && mod.default.getDocument ? mod.default : mod);
  }
  const loadingTask = cached.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  const pages: PageInfo[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = content.items
      .filter((it: any) => typeof it.str === 'string')
      .map((it: any) => ({
        text: it.str,
        x: it.transform[4],
        // pdf.js y is measured from the baseline, bottom-up.
        y: viewport.height - it.transform[5],
        width: it.width,
        fontName: it.fontName,
      }));
    pages.push({
      width: viewport.width,
      height: viewport.height,
      items,
      // pdf.js splits into per-glyph runs for skewed text; join with no
      // separator so words survive, matching how they read on the page.
      text: items.map((i) => i.text).join(''),
    });
    page.cleanup();
  }
  const destroy = loadingTask.destroy;
  if (typeof destroy === 'function') await destroy.call(loadingTask);
  return pages;
}

/** All text across every page, newline-separated. */
export async function pdfText(buf: Buffer | Uint8Array): Promise<string> {
  const pages = await extractPdf(buf);
  return pages.map((p) => p.text).join('\n');
}

/**
 * The amount printed on the totals row that follows `label`.
 *
 * Column layout means labels and values are separate text runs, so the amount is
 * located positionally: the run nearest the label on the same baseline.
 */
export async function amountAfterLabel(buf: Buffer, label: string): Promise<number | null> {
  const pages = await extractPdf(buf);
  for (const page of pages) {
    const idx = page.items.findIndex((i) => i.text.trim().startsWith(label));
    if (idx < 0) continue;
    const lbl = page.items[idx];
    const candidates = page.items
      .filter((i) => Math.abs(i.y - lbl.y) < 3)
      .map((i) => ({ i, d: Math.abs(i.y - lbl.y) + Math.abs(i.x - lbl.x) }))
      .sort((a, b) => a.d - b.d)
      .map((c) => c.i.text);
    for (const t of candidates) {
      const m = /₹\s*([\d,]+\.\d{2})/.exec(t);
      if (m) return Number(m[1].replace(/,/g, ''));
    }
    // Same line, joined text fallback.
    const sameLine = page.items.filter((i) => Math.abs(i.y - lbl.y) < 3).map((i) => i.text).join('');
    const m = /₹\s*([\d,]+\.\d{2})/.exec(sameLine);
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}