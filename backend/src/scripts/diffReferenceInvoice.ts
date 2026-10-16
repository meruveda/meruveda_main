/* eslint-disable */
/**
 * Layout diff: reference invoice vs a generated sample.
 *
 *   npm run invoice:diff-reference -w backend
 *
 * Once docs/reference/reference-invoice.pdf exists, this compares it against the
 * generated MV-748371 sample (docs/samples/06-cod-MV-748371.pdf) and reports
 * differences in:
 *   - page geometry
 *   - the set of drawn labels (added / missing)
 *   - the logo (embedded in one and not the other)
 *   - numeric tokens (amounts, dates, invoice/order numbers)
 *
 * Deliberately compares STRUCTURE, not pixels: the two documents hold different
 * data by definition, so "these strings differ" is expected. What must not
 * differ is the set of labels and the geometry.
 *
 * Exit code 1 when a structural difference is found, so it can gate CI.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { extractPdf } from '../utils/pdfText';

const REFERENCE = path.resolve(__dirname, '../../../docs/reference/reference-invoice.pdf');
const SAMPLE = path.resolve(__dirname, '../../../docs/samples/06-cod-MV-748371.pdf');

/**
 * Page geometry + drawn text.
 *
 * Uses the pdf.js extractor, NOT a content-stream regex: with embedded
 * subset fonts pdf-lib emits CID glyph indices into a custom encoding, so the
 * real characters are only reachable through the ToUnicode CMap. A hand-rolled
 * hex decode returns glyph ids, which makes every label comparison vacuous.
 */
async function inspect(file: string) {
  const pdf = readFileSync(file);
  const pages = await extractPdf(pdf);

  const raw = pdf.toString('latin1');
  const hasImage = /\/Subtype\s*\/Image/.test(raw);
  const strings = pages.flatMap((p) => p.items.map((i) => i.text));
  const numbers = new Set<string>();
  for (const s of strings) {
    for (const m of s.matchAll(/\b\d[\d,]*\.\d{2}\b/g)) numbers.add(m[0]);
  }

  return {
    bytes: pdf.length,
    pages: pages.length,
    mediaBox: pages[0] ? [0, 0, pages[0].width, pages[0].height] : null,
    hasImage,
    strings,
    numbers: [...numbers],
  };
}
/** Labels are the non-numeric, non-address strings that make up the layout. */
const NOISE = /^\s*$|^Rs\.?\s|^\d|^[A-Za-z]{1,2}$/;
function labels(strings: string[]) {
  return new Set(
    strings
      .map((s) => s.trim())
      .filter((s) => s.length > 1)
      .filter((s) => !NOISE.test(s))
      .filter((s) => !/^\d/.test(s))
  );
}

async function main() {
  if (!existsSync(REFERENCE)) {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║  docs/reference/reference-invoice.pdf NOT FOUND                     ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Add the reference invoice at:');
    console.log('  docs/reference/reference-invoice.pdf');
    console.log('');
    console.log('Then re-run:  npm run invoice:diff-reference -w backend');
    console.log('');
    console.log('Nothing to compare yet — exiting 0 so this is not a CI failure while');
    console.log('the reference is still being sourced.');
    process.exit(0);
  }
  if (!existsSync(SAMPLE)) {
    console.error(`sample missing: ${SAMPLE}`);
    console.error('generate it first:  npm run samples:order -w backend');
    process.exit(1);
  }

  const ref = await inspect(REFERENCE);
  const gen = await inspect(SAMPLE);

  console.log('reference :', path.relative(process.cwd(), REFERENCE), `(${ref.bytes} bytes)`);
  console.log('generated :', path.relative(process.cwd(), SAMPLE), `(${gen.bytes} bytes)`);
  console.log('');

  const problems: string[] = [];

  // 1. geometry
  console.log('── geometry ──');
  const fmtBox = (b: number[] | null) => (b ? b.join(' x ') : 'unknown');
  console.log(`  reference MediaBox : ${fmtBox(ref.mediaBox)}  (${ref.pages} page(s))`);
  console.log(`  generated MediaBox : ${fmtBox(gen.mediaBox)}  (${gen.pages} page(s))`);
  if (ref.mediaBox && gen.mediaBox) {
    if (ref.mediaBox[2] !== gen.mediaBox[2] || ref.mediaBox[3] !== gen.mediaBox[3]) {
      problems.push(
        `page size differs: reference ${ref.mediaBox[2]}x${ref.mediaBox[3]} vs generated ${gen.mediaBox[2]}x${gen.mediaBox[3]}`
      );
    }
  } else if (ref.mediaBox && !gen.mediaBox) {
    problems.push('generated PDF has no readable /MediaBox');
  }
  console.log('');

  // 2. logo
  console.log('── logo ──');
  console.log(`  reference has an embedded image : ${ref.hasImage}`);
  console.log(`  generated has an embedded image : ${gen.hasImage}`);
  if (ref.hasImage && !gen.hasImage) {
    problems.push('reference embeds a logo but the generated invoice does not — check backend/assets bundling');
  }
  console.log('');

  // 3. label set
  console.log('── labels (structure) ──');
  const refLabels = labels(ref.strings);
  const genLabels = labels(gen.strings);
  const missing = [...refLabels].filter((l) => !genLabels.has(l));
  const added = [...genLabels].filter((l) => !refLabels.has(l));
  console.log(`  reference: ${refLabels.size} label(s); generated: ${genLabels.size}`);
  if (missing.length) {
    console.log('  MISSING from generated:');
    for (const l of missing) console.log(`    - ${l}`);
    problems.push(`${missing.length} label(s) present in the reference but not generated`);
  } else {
    console.log('  every reference label is present in the generated invoice');
  }
  if (added.length) {
    console.log('  present only in generated (usually just data, but check these):');
    for (const l of added) console.log(`    + ${l}`);
  }
  console.log('');

  // 4. numeric tokens
  console.log('── numeric tokens (expected to differ: different data) ──');
  console.log(`  reference: ${ref.numbers.join(', ') || '(none)'}`);
  console.log(`  generated: ${gen.numbers.join(', ') || '(none)'}`);
  console.log('');

  if (problems.length === 0) {
    console.log('RESULT: no structural differences found.');
    process.exit(0);
  }
  console.log('RESULT: structural differences found:');
  for (const p of problems) console.log(`  ! ${p}`);
  process.exit(1);
}

// CommonJS output: no top-level await.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});