// Copies non-TypeScript runtime assets into dist/ after `tsc`.
//
// `tsc` only emits .js — backend/assets/meruveda-logo.png stays in the source
// tree and is NOT in dist/. On Vercel the function runs from the build output,
// so the invoice generator's readFileSync(LOGO_PATH) missed the file and every
// invoice rendered WITHOUT the logo, silently (the failure path only warns).
//
// Run via `npm run build -w backend`.
const { cpSync, existsSync, mkdirSync } = require('fs');
const { join, resolve } = require('path');

const root = resolve(__dirname, '..');
const src = join(root, 'assets');
const dest = join(root, 'dist', 'assets');

if (!existsSync(src)) {
  console.warn('[copy-assets] no assets/ directory to copy');
  process.exit(0);
}

mkdirSync(join(root, 'dist'), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-assets] copied ${src} -> ${dest}`);

// expected-schema.json (canonical DB shape) is read at runtime by
// GET /api/health/deep to detect schema drift. It lives outside src/, which
// tsc never copies, so ship it in dist/database/neon/ explicitly.
const schemaSrc = join(root, 'database', 'neon', 'expected-schema.json');
if (existsSync(schemaSrc)) {
  const schemaDestDir = join(root, 'dist', 'database', 'neon');
  mkdirSync(schemaDestDir, { recursive: true });
  cpSync(schemaSrc, join(schemaDestDir, 'expected-schema.json'));
  console.log(`[copy-assets] copied ${schemaSrc} -> ${schemaDestDir}`);
} else {
  console.warn('[copy-assets] expected-schema.json not found — /api/health/deep schema check will warn');
}