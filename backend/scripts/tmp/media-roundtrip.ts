/**
 * Round-trip test for the admin Media Library: upload an image to R2, read
 * it back over the public URL, then delete it.
 */
import 'dotenv/config';
import sharp from 'sharp';
import { storageService } from '../../src/services/storageService';
import { deleteObject, objectExists, mediaBucket } from '../../src/services/r2';

async function main(): Promise<void> {
  // A tiny but real PNG.
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 180, g: 120, b: 60 } },
  })
    .png()
    .toBuffer();

  const { storagePath, publicUrl } = await storageService.uploadImage(
    { buffer: png, originalname: 'roundtrip-test.png', mimetype: 'image/png' } as any,
    'general-media',
  );
  console.log('uploaded  :', storagePath);
  console.log('public url:', publicUrl);

  const head = await fetch(publicUrl, { method: 'HEAD' });
  console.log('public GET:', head.status, head.headers.get('content-type'));

  const onR2 = await objectExists(mediaBucket(), storagePath);
  console.log('exists in R2:', onR2);

  // And the delete.
  await storageService.deleteImage(storagePath, 'general-media');
  const after = await objectExists(mediaBucket(), storagePath);
  console.log('exists after delete:', after);

  const gone = await fetch(publicUrl, { method: 'HEAD' });
  console.log('public GET after delete:', gone.status);

  if (head.status !== 200 || !onR2 || after) {
    console.error('ROUND TRIP FAILED');
    process.exit(1);
  }
  console.log('\nROUND TRIP OK');
}

main().catch((e) => {
  console.error('FATAL', e?.stack || e);
  process.exit(1);
});
