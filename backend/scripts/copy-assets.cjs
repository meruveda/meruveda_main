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