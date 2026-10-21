import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

/**
 * Cloudflare R2 is S3-compatible. One lazily-created client, bucket names from
 * env, and no bucket creation at runtime — Phase B creates both buckets once.
 *
 * Public media URLs MUST come from R2_PUBLIC_BASE_URL. Nothing here knows or
 * hardcodes a domain.
 */

let client: S3Client | null = null;

/**
 * A test seam: swap the S3 client.
 *
 * The media upload has to be testable without the network and without writing
 * a single object, so the client can be replaced with a mock.
 */
let testClient: S3Client | null = null;

export function __setR2ClientForTests(next: S3Client | null): void {
  testClient = next;
}

export function r2Configured(): boolean {
  if (client || testClient) return true;
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

export function mediaBucket(): string {
  return process.env.R2_BUCKET_MEDIA || 'meruveda-media';
}

export function invoicesBucket(): string {
  return process.env.R2_BUCKET_INVOICES || 'meruveda-invoices';
}

export function r2Endpoint(): string {
  return `https://${process.env.R2_ACCOUNT_ID || ''}.r2.cloudflarestorage.com`;
}

export function getR2Client(): S3Client {
  if (testClient) return testClient;
  if (!client) {
    if (!r2Configured()) {
      throw Object.assign(
        new Error('R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY missing).'),
        { status: 503 },
      );
    }
    client = new S3Client({
      region: 'auto',
      endpoint: r2Endpoint(),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
      forcePathStyle: true,
    });
  }
  return client;
}

export function publicBaseUrl(): string {
  return (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
}

export function publicUrlFor(key: string): string {
  const base = publicBaseUrl();
  if (!base) return '';
  return `${base}/${key.replace(/^\/+/, '')}`;
}

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
  /** Fail with `PreconditionFailed` when the key already exists. */
  ifAbsent?: boolean;
  metadata?: Record<string, string>;
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | string,
  options: PutOptions = {},
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      Metadata: options.metadata,
      ...(options.ifAbsent ? { IfNoneMatch: '*' } : {}),
    }),
  );
}

/**
 * Atomic create-or-fail. Returns false when the key already exists (412 /
 * PreconditionFailed), which is the same create-or-fail behaviour
 * the invoice claim and counter markers relied on.
 */
export async function putObjectIfAbsent(
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | string,
  options: PutOptions = {},
): Promise<boolean> {
  try {
    await putObject(bucket, key, body, { ...options, ifAbsent: true });
    return true;
  } catch (err: any) {
    if (isPreconditionFailed(err)) return false;
    throw err;
  }
}

function isPreconditionFailed(err: any): boolean {
  return (
    err?.name === 'PreconditionFailed' ||
    err?.$metadata?.httpStatusCode === 412 ||
    err?.Code === 'PreconditionFailed'
  );
}

function isNotFound(err: any): boolean {
  return (
    err?.name === 'NoSuchKey' ||
    err?.name === 'NotFound' ||
    err?.$metadata?.httpStatusCode === 404
  );
}

export async function getObjectBuffer(bucket: string, key: string): Promise<Buffer | null> {
  try {
    const res = await getR2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) return null;
    const bytes = await (res.Body as any).transformToByteArray();
    return Buffer.from(bytes);
  } catch (err: any) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err: any) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  try {
    await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err: any) {
    if (isNotFound(err)) return;
    throw err;
  }
}

export async function deleteObjects(bucket: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  // S3 DeleteObjects caps at 1000 keys per request.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await getR2Client().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

export interface ListResult {
  keys: Array<{ key: string; name: string; size?: number; lastModified?: Date }>;
  prefixes: string[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export async function listObjects(
  bucket: string,
  prefix: string,
  opts: { delimiter?: string; limit?: number; continuationToken?: string } = {},
): Promise<ListResult> {
  const res = await getR2Client().send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: opts.delimiter,
      MaxKeys: opts.limit,
      ContinuationToken: opts.continuationToken,
    }),
  );

  const keys = (res.Contents || []).map((o) => {
    const key = o.Key || '';
    return {
      key,
      name: prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key,
      size: o.Size,
      lastModified: o.LastModified,
    };
  });

  return {
    keys,
    prefixes: (res.CommonPrefixes || []).map((p) => p.Prefix || '').filter(Boolean),
    isTruncated: Boolean(res.IsTruncated),
    nextContinuationToken: res.NextContinuationToken,
  };
}

export async function signedGetUrl(bucket: string, key: string, expiresInSeconds: number): Promise<string | null> {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  try {
    return await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: Math.max(60, expiresInSeconds) },
    );
  } catch (err: any) {
    console.warn('[R2] signed URL failed:', err?.message || err);
    return null;
  }
}

/** Re-exported so callers can stream without importing the SDK directly. */
export { Readable };
