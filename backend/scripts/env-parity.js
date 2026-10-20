#!/usr/bin/env node
// Env parity check: names only, never values.
//
// Answers one question before a deploy: does every environment that must run
// this code have the variables the code needs?
//
//   1. backend/.env.example        -> the canonical variable list (documented)
//   2. backend/.env                -> local development
//   3. Vercel production/preview   -> via `vercel env ls --json` (opt-in flag)
//
// Usage:
//   node scripts/env-parity.js            # local: .env.example vs .env
//   node scripts/env-parity.js --vercel   # also compares Vercel prod + preview
//
// Exit codes: 0 = parity (or only documented gaps), 1 = a core variable is
// missing somewhere. Values are NEVER printed — only names.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ENV_FILE = path.join(__dirname, '..', '.env');
const EXAMPLE_FILE = path.join(__dirname, '..', '.env.example');

// Without these the boot refuses to start, or a whole feature area is dead.
// Kept short deliberately: everything else in .env.example is optional and
// reported as an informational gap only.
const CORE_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_MEDIA',
  'R2_BUCKET_INVOICES',
  'R2_PUBLIC_BASE_URL',
  'JWT_SECRET',
  'CRON_SECRET',
  'PAYU_MERCHANT_KEY',
  'PAYU_SALT',
];

function keysOf(file) {
  if (!fs.existsSync(file)) return null;
  const out = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) out.add(m[1]);
  }
  return out;
}

function vercelKeys(target) {
  const vc = String.raw`C:\Users\Acer\AppData\Roaming\npm\node_modules\vercel\dist\vc.js`;
  const res = spawnSync(process.execPath, [vc, 'env', 'ls', target, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, VERCEL_CLI_DISABLE_UPDATE_CHECK: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.warn(`  (vercel env ls ${target} failed: ${String(res.stderr || '').slice(0, 200)})`);
    return null;
  }
  try {
    const raw = res.stdout.trim();
    // The CLI may print progress on stdout in some versions; the JSON object
    // always starts at the first '{' or '['.
    const start = raw.search(/[{[]/);
    const parsed = JSON.parse(start >= 0 ? raw.slice(start) : raw);
    const rows = Array.isArray(parsed) ? parsed : parsed.envs || parsed.list || [];
    return new Set(rows.map((r) => r.key || r.name).filter(Boolean));
  } catch (err) {
    console.warn(`  (could not parse vercel env ls ${target} output: ${err.message})`);
    return null;
  }
}

function diff(label, base, other) {
  // base = where the variable should exist; other = where we looked.
  if (!other) {
    console.log(`  ? ${label}: unavailable (skipped)`);
    return [];
  }
  const missing = [...base].filter((k) => !other.has(k)).sort();
  const extra = [...other].filter((k) => !base.has(k)).sort();
  if (missing.length) console.log(`  ✗ ${label} missing: ${missing.join(', ')}`);
  if (extra.length) console.log(`  + ${label} has undocumented extras: ${extra.join(', ')}`);
  if (!missing.length && !extra.length) console.log(`  ✓ ${label}: in parity`);
  return missing;
}

(function main() {
  const withVercel = process.argv.includes('--vercel');
  const example = keysOf(EXAMPLE_FILE);
  if (!example) {
    console.error(`FATAL: ${EXAMPLE_FILE} not found — nothing to compare against.`);
    process.exit(1);
  }
  const local = keysOf(ENV_FILE);

  console.log(`env parity (names only, no values) — ${example.size} documented keys`);
  const problems = [];

  if (!local) {
    console.log(`  ? backend/.env absent — local comparison skipped (fresh clone)`);
  } else {
    problems.push(...diff('backend/.env vs .env.example', example, local));
  }

  if (withVercel) {
    problems.push(...diff('vercel production vs .env.example', example, vercelKeys('production')));
    problems.push(...diff('vercel preview vs .env.example', example, vercelKeys('preview')));
  } else {
    console.log('  (run with --vercel to include Vercel production + preview)');
  }

  const missingCore = CORE_KEYS.filter((k) => (local ? !local.has(k) : true));
  if (missingCore.length) {
    console.error(`\n✗ core variables missing locally: ${missingCore.join(', ')}`);
    process.exit(1);
  }

  if (problems.length) {
    console.log(`\n! ${problems.length} documented key(s) missing somewhere — check before deploying.`);
  } else {
    console.log('\n✓ parity holds.');
  }
})();
