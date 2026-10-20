/**
 * `node scripts/r2-verify.js` — prove the R2 credentials and buckets work
 * before anything is allowed to depend on them.
 *
 * Checks, in order (never printing a secret):
 *   1. R2_* value formats (account id = 32 hex chars, no URL/space/quotes)
 *   2. ListBuckets            -> credentials actually authenticate
 *   3. HeadBucket(media)      -> meruveda-media exists (public media)
 *   4. HeadBucket(invoices)   -> meruveda-invoices exists (private)
 *   5. Put + Head + Get + Delete of a probe object in the media bucket
 *   6. Presigned GET URL for a probe object in the private invoices bucket
 *   7. R2_PUBLIC_BASE_URL shape (https URL) and reachability of its root
 *
 * Exit code 0 only when everything passes.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const {
  S3Client,
  ListBucketsCommand,
  HeadBucketCommand,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

function checkFormats() {
  const account = (process.env.R2_ACCOUNT_ID || '').trim();
  const accessKey = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secret = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const raw = {
    account: process.env.R2_ACCOUNT_ID || '',
    accessKey: process.env.R2_ACCESS_KEY_ID || '',
    secret: process.env.R2_SECRET_ACCESS_KEY || '',
    publicBase: process.env.R2_PUBLIC_BASE_URL || '',
  };

  record(
    'R2_ACCOUNT_ID format (32 hex, no url/space)',
    /^[0-9a-f]{32}$/.test(account),
    /^[0-9a-f]{32}$/.test(account) ? 'ok' : `length=${raw.account.trim().length}, not 32 lowercase-hex`,
  );
  record(
    'R2_ACCESS_KEY_ID format (no space/quote)',
    accessKey.length > 0 && accessKey.length <= 100 && !/[\s'"]/.test(raw.accessKey.trim()),
    accessKey.length > 0 ? `length=${accessKey.length}` : 'empty',
  );
  record(
    'R2_SECRET_ACCESS_KEY format (no space/quote)',
    secret.length > 0 && !/[\s'"]/.test(raw.secret.trim()),
    secret.length > 0 ? `length=${secret.length}` : 'empty',
  );

  const base = raw.publicBase.trim().replace(/\/+$/, '');
  record(
    'R2_PUBLIC_BASE_URL shape (https URL)',
    /^https:\/\/[a-z0-9.-]+(\/.*)?$/i.test(base),
    /^https:\/\/[a-z0-9.-]+(\/.*)?$/i.test(base) ? 'ok' : `starts with "${base.slice(0, 12)}..." (expected https://host)`,
  );
  return /^[0-9a-f]{32}$/.test(account) && accessKey && secret;
}

async function main() {
  const formatsOk = checkFormats();
  if (!formatsOk) {
    console.error('R2 credentials are malformed — fix backend/.env first (and mirror to Vercel).');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
    },
    forcePathStyle: true,
  });

  const media = (process.env.R2_BUCKET_MEDIA || 'meruveda-media').trim();
  const invoices = (process.env.R2_BUCKET_INVOICES || 'meruveda-invoices').trim();

  let bucketNames = null;
  try {
    const listed = await client.send(new ListBucketsCommand({}));
    bucketNames = (listed.Buckets || []).map((b) => b.Name);
    record('ListBuckets (credentials)', true, `${bucketNames.length} bucket(s): ${bucketNames.join(', ') || 'none'}`);
  } catch (err) {
    if (err?.name === 'AccessDenied' || err?.$metadata?.httpStatusCode === 403) {
      // Bucket-scoped R2 tokens cannot list the account — that is the
      // least-privilege setup we want. HeadBucket below proves access anyway.
      record('ListBuckets (credentials)', true, 'account-level listing denied (bucket-scoped token) — proving access via HeadBucket');
    } else {
      record('ListBuckets (credentials)', false, err?.name || err?.message);
      console.error('Stopping: without valid credentials the remaining checks cannot run.');
      process.exit(1);
    }
  }

  if (bucketNames) {
    record(`bucket ${media} present`, bucketNames.includes(media), bucketNames.includes(media) ? '' : 'create it in the R2 dashboard');
    record(`bucket ${invoices} present`, bucketNames.includes(invoices), bucketNames.includes(invoices) ? '' : 'create it in the R2 dashboard');
  }

  const probeKey = `health/probe-${Date.now()}.txt`;
  const probeBody = Buffer.from(`r2-verify ${new Date().toISOString()}`);

  try {
    await client.send(new HeadBucketCommand({ Bucket: media }));
    record(`HeadBucket ${media}`, true);
  } catch (err) {
    record(`HeadBucket ${media}`, false, err?.$metadata?.httpStatusCode || err?.message);
  }

  try {
    await client.send(new HeadBucketCommand({ Bucket: invoices }));
    record(`HeadBucket ${invoices}`, true);
  } catch (err) {
    record(`HeadBucket ${invoices}`, false, err?.$metadata?.httpStatusCode || err?.message);
  }

  try {
    await client.send(new PutObjectCommand({ Bucket: media, Key: probeKey, Body: probeBody, ContentType: 'text/plain', CacheControl: 'public, max-age=31536000, immutable' }));
    await client.send(new HeadObjectCommand({ Bucket: media, Key: probeKey }));
    const got = await client.send(new GetObjectCommand({ Bucket: media, Key: probeKey }));
    const bytes = await got.Body.transformToByteArray();
    record('media Put/Head/Get', bytes.length === probeBody.length, `${bytes.length} bytes round-tripped`);
    await client.send(new DeleteObjectCommand({ Bucket: media, Key: probeKey }));
    record('media Delete', true, 'probe cleaned up');
  } catch (err) {
    record('media Put/Head/Get', false, err?.name || err?.message);
    await client.send(new DeleteObjectCommand({ Bucket: media, Key: probeKey })).catch(() => undefined);
  }

  const invoiceKey = `health/probe-${Date.now()}.txt`;
  try {
    await client.send(new PutObjectCommand({ Bucket: invoices, Key: invoiceKey, Body: probeBody, ContentType: 'text/plain' }));
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: invoices, Key: invoiceKey }), { expiresIn: 60 });
    const res = await fetch(url, { method: 'GET' });
    record('invoices presigned GET (private)', res.status === 200, `status ${res.status}`);
    await client.send(new DeleteObjectCommand({ Bucket: invoices, Key: invoiceKey }));
    record('invoices Delete', true, 'probe cleaned up');
  } catch (err) {
    record('invoices presigned GET (private)', false, err?.name || err?.message);
    await client.send(new DeleteObjectCommand({ Bucket: invoices, Key: invoiceKey })).catch(() => undefined);
  }

  const base = (process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(base)) {
    try {
      const res = await fetch(base + '/', { method: 'GET', redirect: 'manual' });
      // 200/404/403 all prove DNS + TLS resolve to something; 5xx/ENOTFOUND do not.
      record('R2_PUBLIC_BASE_URL reachable', res.status < 500, `status ${res.status}`);
    } catch (err) {
      record('R2_PUBLIC_BASE_URL reachable', false, err?.cause?.code || err?.message);
    }
  } else {
    record('R2_PUBLIC_BASE_URL reachable', false, 'not an https URL, skipped network check');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.error('FAILED: ' + failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`r2-verify crashed: ${err?.message || err}`);
  process.exit(1);
});
