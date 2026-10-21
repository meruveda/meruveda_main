/**
 * The admin media upload.
 *
 * These tests cover the failure modes that used to reach the browser as a
 * bare 500:
 *   - a file that is not really an image (sharp cannot read it)
 *   - a file that is too large for the platform's request-body limit
 *   - a file type that is not allowed
 *   - an empty file
 *
 * The R2 client is mocked: no object is ever written and no network call is
 * ever made.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { storageService, MAX_FILE_SIZE } from './storageService';
import { __setR2ClientForTests } from './r2';

// The public URL is derived from this.
process.env.R2_PUBLIC_BASE_URL = 'https://pub-unittest.r2.dev';
process.env.R2_BUCKET_MEDIA = 'meruveda-media';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function file(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: PNG_1x1.length,
    buffer: PNG_1x1,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as any,
    ...overrides,
  } as unknown as Express.Multer.File;
}

/** A mock R2 client that records what would have been written. */
function mockR2() {
  const written: Array<{ bucket: string; key: string; body: Buffer }> = [];
  const client = {
    send: async (command: any) => {
      const name = command?.constructor?.name || '';
      if (name === 'PutObjectCommand') {
        written.push({
          bucket: command.input.Bucket,
          key: command.input.Key,
          body: command.input.Body,
        });
      }
      return {};
    },
  };
  __setR2ClientForTests(client as any);
  return written;
}

test('a valid image is converted to webp and written to the media bucket', async (t) => {
  const written = mockR2();
  t.after(() => __setR2ClientForTests(null));

  const result = await storageService.uploadImage(file(), 'general-media');

  assert.match(result.storagePath, /^general-media\/.+\.webp$/);
  assert.match(result.publicUrl, /^https:\/\/pub-[a-z0-9]+\.r2\.dev\/general-media\/.+\.webp$/);
  assert.ok(written.length >= 1, 'the image was written to R2');
  assert.equal(written[0].bucket, 'meruveda-media');
  // The stored bytes really are a webp.
  assert.equal(written[0].body.subarray(8, 12).toString('ascii'), 'WEBP');
});

test('a file that is not really an image is a clear 400, not a 500', async (t) => {
  mockR2();
  t.after(() => __setR2ClientForTests(null));

  const broken = file({
    originalname: 'photo.png',
    mimetype: 'image/png',
    size: 32,
    buffer: Buffer.from('this is definitely not an image at all'),
  });

  await assert.rejects(
    () => storageService.uploadImage(broken, 'general-media'),
    (err: any) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'UNREADABLE_IMAGE');
      assert.match(err.message, /could not be read as an image/i);
      return true;
    },
  );
});

test('a file that is too large is a clear 413 with the limit in the message', async (t) => {
  mockR2();
  t.after(() => __setR2ClientForTests(null));

  const big = file({ size: MAX_FILE_SIZE + 1 });
  await assert.rejects(
    () => storageService.uploadImage(big, 'general-media'),
    (err: any) => {
      assert.equal(err.status, 413);
      assert.equal(err.code, 'FILE_TOO_LARGE');
      assert.match(err.message, /4 MB/);
      return true;
    },
  );
});

test('the size limit stays under the platform request-body limit', () => {
  // Vercel rejects a body over 4.5 MB before the function runs, so the
  // limit we enforce must be below it - otherwise the operator gets an
  // unreadable platform 413 instead of our own message.
  assert.ok(MAX_FILE_SIZE < 4.5 * 1024 * 1024, 'the limit must be under the platform limit');
});

test('a file type that is not an image is a clear 400', async (t) => {
  mockR2();
  t.after(() => __setR2ClientForTests(null));

  const text = file({ mimetype: 'application/pdf', originalname: 'doc.pdf' });
  await assert.rejects(
    () => storageService.uploadImage(text, 'general-media'),
    (err: any) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'INVALID_FILE_TYPE');
      return true;
    },
  );
});

test('an empty file is a clear 400', async (t) => {
  mockR2();
  t.after(() => __setR2ClientForTests(null));

  const empty = file({ size: 0, buffer: Buffer.alloc(0) });
  await assert.rejects(
    () => storageService.uploadImage(empty, 'general-media'),
    (err: any) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'EMPTY_FILE');
      return true;
    },
  );
});
