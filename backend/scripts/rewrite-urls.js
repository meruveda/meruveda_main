/**
 * Rewrite legacy Supabase Storage URLs to the R2 public base URL.
 *
 * Example:
 *   https://<ref>.supabase.co/storage/v1/object/public/general-media/a.png
 *     ->  <R2_PUBLIC_BASE_URL>/general-media/a.png
 *
 * SAFETY
 *   * Dry-run by default: prints what would change, writes nothing.
 *   * --apply is required to edit files.
 *   * Only text files inside the repo are touched; node_modules, .git, build
 *     output, backups, the image cache and every .env* file are skipped.
 *   * The replacement base comes from R2_PUBLIC_BASE_URL; no domain is
 *     hardcoded.
 *   * No file is deleted and no line ending is changed on purpose.
 *
 * Usage:
 *   node scripts/rewrite-urls.js                 # dry run
 *   node scripts/rewrite-urls.js --apply
 *   node scripts/rewrite-urls.js --check         # exit 1 if anything matches
 *   node scripts/rewrite-urls.js --root <dir> --apply
 *   node scripts/rewrite-urls.js --snapshot backups/snapshot-*.json --apply
 *
 * Snapshot mode rewrites every string value in the snapshot and writes a NEW
 * file (default: <snapshot>.r2.json). The input snapshot is never modified.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'coverage',
  'backups',
  'out',
  '.vercel',
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.mov', '.mp3', '.wav', '.xlsx', '.docx', '.pptx',
]);

const URL_RE = /https?:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/([^\s"'`<>)\]]+)/gi;

function parseArgs(argv) {
  const opts = { apply: false, check: false, root: REPO_ROOT, snapshot: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--root') opts.root = path.resolve(argv[++i]);
    else if (arg === '--snapshot') opts.snapshot = path.resolve(argv[++i]);
    else if (arg === '--out') opts.out = path.resolve(argv[++i]);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

function publicBase() {
  const raw = process.env.R2_PUBLIC_BASE_URL;
  if (!raw || !raw.trim()) {
    console.error('Missing required env var: R2_PUBLIC_BASE_URL');
    process.exit(2);
  }
  return raw.trim().replace(/\/+$/, '');
}

function isSkippedFile(file) {
  const name = path.basename(file);
  if (name.startsWith('.env')) return true;
  if (name === '.env.example' || name === '.env.local') return true;
  return BINARY_EXT.has(path.extname(file).toLowerCase());
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && !isSkippedFile(full)) {
      out.push(full);
    }
  }
}

function replacementFor(match, rest, base) {
  // Preserve query/hash if an image URL ever carries one.
  const suffixMatch = /[?#].*$/.exec(rest);
  const suffix = suffixMatch ? suffixMatch[0] : '';
  const keyPart = suffix ? rest.slice(0, -suffix.length) : rest;
  const decoded = keyPart
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
  return `${base}/${decoded}${suffix}`;
}

function rewriteText(text, base) {
  let count = 0;
  const samples = [];
  const next = text.replace(URL_RE, (match, rest) => {
    const replacement = replacementFor(match, rest, base);
    count++;
    if (samples.length < 3) samples.push(`${match} -> ${replacement}`);
    return replacement;
  });
  return { next, count, samples };
}

function rewriteDeep(value, base, stats) {
  if (typeof value === 'string') {
    if (!/supabase\.co\/storage\/v1\/object\/public\//i.test(value)) return value;
    const { next, count } = rewriteText(value, base);
    stats.count += count;
    if (count > 0 && stats.samples.length < 3) {
      stats.samples.push(`${value} -> ${next}`);
    }
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteDeep(item, base, stats));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = rewriteDeep(item, base, stats);
    return out;
  }
  return value;
}

function rewriteSnapshot(opts, base) {
  if (!fs.existsSync(opts.snapshot)) {
    console.error(`Snapshot does not exist: ${opts.snapshot}`);
    process.exit(3);
  }
  const raw = JSON.parse(fs.readFileSync(opts.snapshot, 'utf8'));
  const tables = raw && raw.tables;
  if (!tables || typeof tables !== 'object') {
    console.error('Snapshot has no "tables" object');
    process.exit(3);
  }

  let total = 0;
  const tableStats = [];
  for (const [table, rows] of Object.entries(tables)) {
    const stats = { count: 0, samples: [] };
    tables[table] = rewriteDeep(rows, base, stats);
    if (stats.count > 0) {
      total += stats.count;
      tableStats.push({ table, ...stats });
    }
  }

  const outPath = opts.out || opts.snapshot.replace(/\.json$/i, '') + '.r2.json';
  console.log(`Base: ${base}`);
  console.log(`Snapshot: ${path.relative(REPO_ROOT, opts.snapshot)}`);
  console.log(`Output: ${path.relative(REPO_ROOT, outPath)}`);
  console.log(`Mode: ${opts.apply ? 'APPLY' : opts.check ? 'CHECK' : 'DRY RUN (no writes)'}`);
  console.log(`Tables matched: ${tableStats.length} | URLs matched: ${total}`);

  for (const item of tableStats) {
    console.log(`\n${item.table} (${item.count})`);
    for (const sample of item.samples) console.log(`  ${sample}`);
  }

  if (opts.check) {
    process.exitCode = total > 0 ? 1 : 0;
    return;
  }
  if (!opts.apply) {
    if (total > 0) console.log('\nDry run complete. Re-run with --apply to write the new snapshot.');
    return;
  }
  if (outPath === opts.snapshot) {
    console.error('Refusing to overwrite the input snapshot. Use --out <new file>.');
    process.exit(5);
  }
  fs.writeFileSync(outPath, JSON.stringify(raw), 'utf8');
  console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)} (${total} URL(s) rewritten).`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/rewrite-urls.js [--apply|--check] [--root <dir>] [--snapshot <file> [--out <file>]]');
    return;
  }

  const base = publicBase();
  if (opts.snapshot) {
    rewriteSnapshot(opts, base);
    return;
  }
  if (!fs.existsSync(opts.root)) {
    console.error(`Root does not exist: ${opts.root}`);
    process.exit(3);
  }

  const files = [];
  walk(opts.root, files);

  let touchedFiles = 0;
  let replaced = 0;
  const preview = [];

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!/supabase\.co\/storage\/v1\/object\/public\//i.test(text)) continue;

    const { next, count, samples } = rewriteText(text, base);
    if (count === 0) continue;

    touchedFiles++;
    replaced += count;
    preview.push({ file: path.relative(REPO_ROOT, file), count, samples });

    if (opts.apply && next !== text) {
      fs.writeFileSync(file, next, 'utf8');
    }
  }

  console.log(`Base: ${base}`);
  console.log(`Root: ${path.relative(process.cwd(), opts.root) || '.'}`);
  console.log(`Mode: ${opts.apply ? 'APPLY' : opts.check ? 'CHECK' : 'DRY RUN (no writes)'}`);
  console.log(`Files matched: ${touchedFiles} | URLs matched: ${replaced}`);

  for (const item of preview) {
    console.log(`\n${item.file} (${item.count})`);
    for (const sample of item.samples) console.log(`  ${sample}`);
  }

  if (opts.check) {
    process.exitCode = touchedFiles > 0 ? 1 : 0;
  } else if (!opts.apply && touchedFiles > 0) {
    console.log('\nDry run complete. Re-run with --apply to rewrite.');
  }
}

try {
  main();
} catch (err) {
  console.error('rewrite-urls failed:', err && err.message ? err.message : err);
  process.exit(1);
}
