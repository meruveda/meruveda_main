import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';
import * as mediaRepo from '../database/repos/media';
import { deleteObjects, mediaBucket, publicUrlFor, putObject, r2Configured } from './r2';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/** The historic bucket names are now key prefixes inside the single media bucket. */
export const MEDIA_FOLDERS = ['general-media', 'banners', 'journal'] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

export function resolveMediaFolder(value: unknown): MediaFolder {
  const candidate = String(value || '').trim();
  return (MEDIA_FOLDERS as readonly string[]).includes(candidate)
    ? (candidate as MediaFolder)
    : 'general-media';
}

const VARIANTS = [400, 800, 1600] as const;
const IMMUTABLE = 'public, max-age=31536000, immutable';

function variantKey(baseKey: string, width: number): string {
  return `${baseKey}-${width}.webp`;
}

export const storageService = {
  validateImage(file: Express.Multer.File): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      const error = new Error('Invalid file type. Only JPG, JPEG, PNG, and WEBP are allowed.');
      (error as any).status = 400;
      throw error;
    }

    if (file.size > MAX_FILE_SIZE) {
      const error = new Error('File is too large. Maximum size is 5MB.');
      (error as any).status = 400;
      throw error;
    }
  },

  generateUniqueFilename(originalName: string): string {
    const ext = path.extname(originalName);
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    return `${uniqueSuffix}${ext}`;
  },

  /**
   * Store the original as WebP plus 400/800/1600 px variants, all with immutable
   * cache headers. The returned `storagePath` is the full-size WebP object —
   * that is the stable key written to `media.storage_path`.
   */
  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<{ storagePath: string; publicUrl: string; variants: string[] }> {
    this.validateImage(file);

    if (!r2Configured()) {
      const err = new Error('Media storage is not configured (R2 credentials missing).');
      (err as any).status = 503;
      throw err;
    }

    const safeFolder = resolveMediaFolder(folder);
    const baseName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const baseKey = `${safeFolder}/${baseName}.webp`;

    const full = await sharp(file.buffer).rotate().webp({ quality: 82 }).toBuffer();
    await putObject(mediaBucket(), baseKey, full, {
      contentType: 'image/webp',
      cacheControl: IMMUTABLE,
    });

    const metadata = await sharp(file.buffer).metadata();
    const variants: string[] = [];
    for (const width of VARIANTS) {
      if (metadata.width && metadata.width <= width) continue;
      const resized = await sharp(file.buffer).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const key = variantKey(baseKey, width);
      await putObject(mediaBucket(), key, resized, {
        contentType: 'image/webp',
        cacheControl: IMMUTABLE,
      });
      variants.push(key);
    }

    return {
      storagePath: baseKey,
      publicUrl: publicUrlFor(baseKey),
      variants,
    };
  },

  getPublicUrl(storagePath: string): string {
    return publicUrlFor(storagePath);
  },

  async deleteImage(storagePath: string, _bucket?: string): Promise<void> {
    try {
      await deleteObjects(mediaBucket(), [storagePath, ...VARIANTS.map((w) => variantKey(storagePath, w))]);
    } catch (err: any) {
      console.error(`Failed to delete image ${storagePath} from R2:`, err?.message || err);
      // Log but do not throw: a missing object must not block record deletion.
    }
  },

  async deleteImagesByUrls(urls: string[]): Promise<void> {
    if (!urls || urls.length === 0) return;

    const mediaRecords = await mediaRepo.findMediaByUrls(urls).catch((err) => {
      console.error('Failed to fetch media records for deletion by URLs:', err);
      return [];
    });

    if (mediaRecords.length === 0) return;

    const keys: string[] = [];
    const idsToDelete: string[] = [];
    for (const record of mediaRecords) {
      if (record.storage_path) {
        keys.push(record.storage_path);
        for (const width of VARIANTS) keys.push(variantKey(record.storage_path, width));
        idsToDelete.push(record.id);
      }
    }

    try {
      await deleteObjects(mediaBucket(), keys);
    } catch (err: any) {
      console.error('Failed to bulk delete images from R2:', err?.message || err);
    }

    if (idsToDelete.length > 0) {
      await mediaRepo.deleteMediaByIds(idsToDelete).catch((err) => {
        console.error('Failed to delete media records:', err);
      });
    }
  },
};
