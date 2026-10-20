/**
 * Upload legacy media objects to Cloudflare R2.
 *
 * Source of truth: a backup snapshot (backend/backups/snapshot-*.json) lists
 * every media row (bucket, storage_path, public_url, mime_type). The original
 * bytes are looked up in the image proxy cache as .cache/images/<sha1(url)>.src.
 * Missing sources can be fetched from the still-live Supabase URL, but only
 * with an explicit --fetch-missing flag.
 *
 * SAFETY
 *   * Dry-run by default: prints the plan and makes no network calls.
 *   * --apply is required to talk to R2 (and --fetch-missing for Supabase).
 *   * Uploads never overwrite an existing object (IfNoneMatch: '*').
 *   * No bucket is ever created; R2_BUCKET_MEDIA must already exist.
 *   * Everything comes from env (R2_ACCOUNT_ID / _ACCESS_KEY_ID /
 *     _SECRET_ACCESS_KEY / R2_BUCKET_MEDIA); no hardcoded domains or keys.
 *   * Nothing is deleted from disk, R2 or the snapshot.
 *
 * Usage:
 *   node scripts/upload-assets.js                  # dry run
 *   node scripts/upload-assets.js --apply
 *   node scripts/upload-assets.js --apply --fetch-missing
 *   node scripts/upload-assets.js --snapshot backups/snapshot-...json
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKEND_DIR = path.join(__dirname, '..');
const CACHE_DIR = path.join(BACKEND_DIR, '.cache', 'images');
const BACKUP_DIR = path.join(BACKEND_DIR, 'backups');
const SAFE_KEY = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/;

function parseArgs(argv) {
  const opts = {
    apply: false,
    fetchMissing: false,
    snapshot: null,
    limit: Infinity,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--fetch-missing') opts.fetchMissing = true;
    else if (arg === '--snapshot') opts.snapshot = argv[++i];
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 1) {
    console.error('--limit must be a positive number');
    process.exit(1);
  }
  return opts;
}

function latestSnapshot() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^snapshot-.*\.json$/.test(name))
    .map((name) => path.join(BACKUP_DIR, name))
    .sort();
  return files.length ? files[files.length - 1] : null;
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function envValue(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : '';
}

function requireR2Env() {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_MEDIA'];
  const missing = required.filter((name) => !envValue(name));
  if (missing.length) {
    console.error('Missing required env vars (names only): ' + missing.join(', '));
    process.exit(2);
  }
  return {
    accountId: envValue('R2_ACCOUNT_ID'),
    accessKeyId: envValue('R2_ACCESS_KEY_ID'),
    secretAccessKey: envValue('R2_SECRET_ACCESS_KEY'),
    bucket: envValue('R2_BUCKET_MEDIA'),
  };
}

function loadRows(snapshotPath) {
  const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const rows = raw && raw.tables && Array.isArray(raw.tables.media) ? raw.tables.media : null;
  if (!rows) {
    console.error(`Snapshot has no tables.media array: ${snapshotPath}`);
    process.exit(3);
  }
  return rows;
}

function buildPlan(rows) {
  const plan = [];
  const problems = [];
  const seen = new Set();

  for (const row of rows) {
    const bucket = String(row.bucket || '').trim();
    const storagePath = String(row.storage_path || '').trim();
    const publicUrl = String(row.public_url || '').trim();
    const key = `${bucket}/${storagePath}`;

    if (!bucket || !storagePath || !publicUrl) {
      problems.push({ id: row.id, reason: 'row is missing bucket/storage_path/public_url' });
      continue;
    }
    if (!SAFE_KEY.test(key)) {
      problems.push({ id: row.id, reason: `unsafe object key: ${key}` });
      continue;
    }
    if (seen.has(key)) {
      problems.push({ id: row.id, reason: `duplicate object key: ${key}` });
      continue;
    }
    seen.add(key);

    const cacheFile = path.join(CACHE_DIR, `${sha1(publicUrl)}.src`);
    plan.push({
      id: row.id,
      key,
      publicUrl,
      contentType: String(row.mime_type || 'application/octet-stream'),
      cacheFile,
      source: fs.existsSync(cacheFile) ? 'cache' : null,
    });
  }

  return { plan, problems };
}

function fetchBuffer(url) {
  return fetch(url, { redirect: 'follow' }).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

async function uploadPlan(plan, opts, r2) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
  });

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of plan) {
    try {
      let body;
      if (item.source === 'cache') {
        body = fs.readFileSync(item.cacheFile);
      } else if (opts.fetchMissing) {
        body = await fetchBuffer(item.publicUrl);
      } else {
        console.log(`SKIP ${item.key} (no cached source; pass --fetch-missing)`);
        skipped++;
        continue;
      }

      await client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: item.key,
          Body: body,
          ContentType: item.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
          IfNoneMatch: '*',
        })
      );
      console.log(`PUT  ${item.key} (${body.length} bytes)`);
      uploaded++;
    } catch (err) {
      if (err && (err.name === 'PreconditionFailed' || err.$metadata?.httpStatusCode === 412)) {
        console.log(`SKIP ${item.key} (already exists)`);
        skipped++;
        continue;
      }
      console.error(`FAIL ${item.key}: ${err && err.message ? err.message : err}`);
      failed++;
    }
  }

  return { uploaded, skipped, failed };
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/upload-assets.js [--apply] [--fetch-missing] [--snapshot <file>] [--limit N]');
    return;
  }

  const snapshotPath = opts.snapshot ? path.resolve(opts.snapshot) : latestSnapshot();
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    console.error('No snapshot found. Pass --snapshot <backend/backups/snapshot-*.json>');
    process.exit(4);
  }

  const rows = loadRows(snapshotPath).slice(0, opts.limit);
  const { plan, problems } = buildPlan(rows);

  console.log(`Snapshot: ${path.relative(process.cwd(), snapshotPath)}`);
  console.log(`Media rows: ${rows.length} | uploadable: ${plan.length} | problems: ${problems.length}`);
  console.log(`Cached sources: ${plan.filter((p) => p.source).length} | missing: ${plan.filter((p) => !p.source).length}`);
  console.log(`Mode: ${opts.apply ? 'APPLY' : 'DRY RUN (no network, no writes)'}`);

  for (const problem of problems) {
    console.log(`PROBLEM ${problem.id || '(no id)'}: ${problem.reason}`);
  }
  for (const item of plan) {
    console.log(`${opts.apply ? 'PLAN' : 'WOULD'} PUT ${item.key} <= ${item.source || 'missing source'}`);
  }

  if (!opts.apply) {
    console.log('Dry run complete. Re-run with --apply to upload.');
    return;
  }

  const r2 = requireR2Env();
  const result = await uploadPlan(plan, opts, r2);
  console.log(`Done. uploaded=${result.uploaded} skipped=${result.skipped} failed=${result.failed}`);
  if (result.failed > 0) process.exitCode = 5;
})().catch((err) => {
  console.error('upload-assets failed:', err && err.message ? err.message : err);
  process.exit(1);
});
