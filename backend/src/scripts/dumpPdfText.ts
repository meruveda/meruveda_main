/* eslint-disable */
/**
 * Dump the drawn text of an invoice PDF so two renders can be diffed by eye.
 *   node --require ts-node/register/transpile-only --require ./src/testEnvSetup.ts src/scripts/dumpPdfText.ts <pdf> [out]
 */
import { readFileSync, writeFileSync } from 'fs';
import zlib from 'zlib';

const [, , input, output] = process.argv;

function drawnText(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const streams: string[] = [];
  const looksLikeContent = (s: string) => /\bT[jJ]\b/.test(s) || /(^|\s)BT(\s|$)/.test(s);
  const MARKER = 'stream\n';
  let cursor = 0;
  for (;;) {
    const at = raw.indexOf(MARKER, cursor);
    if (at < 0) break;
    if (raw.slice(Math.max(0, at - 3), at).endsWith('end')) { cursor = at + MARKER.length; continue; }
    const dict = raw.slice(Math.max(0, at - 300), at);
    const declared = /\/Length\s+(\d+)/.exec(dict);
    const start = at + MARKER.length;
    const endAt = raw.indexOf('endstream', start);
    const candidates: number[] = [];
    if (declared) candidates.push(Number(declared[1]));
    if (endAt > start) candidates.push(endAt - start);
    candidates.push(65536);
    for (const len of candidates) {
      if (len <= 0) continue;
      let text: string;
      try {
        text = zlib.inflateSync(Buffer.from(raw.slice(start, start + len), 'latin1')).toString('latin1');
      } catch { continue; }
      if (looksLikeContent(text)) { streams.push(text); break; }
    }
    cursor = endAt > start ? endAt + 9 : at + MARKER.length;
  }

  const decoded: string[] = [];
  for (const stream of streams) {
    for (const m of stream.matchAll(/<([0-9A-Fa-f\s]+)>\s*T[jJ]/g)) {
      const hex = m[1].replace(/\s+/g, '');
      if (hex.length % 2 !== 0) continue;
      let out = '';
      for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      decoded.push(out);
    }
    for (const m of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) decoded.push(m[1].replace(/\\(.)/g, '$1'));
  }
  return decoded;
}

const lines = drawnText(readFileSync(input));
const text = lines.join('\n');
if (output) {
  writeFileSync(output, text);
  console.log(`wrote ${output} (${lines.length} drawn strings)`);
} else {
  console.log(text);
}