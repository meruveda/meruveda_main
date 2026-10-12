import { supabase } from '../database/supabase';
import crypto from 'crypto';
import path from 'path';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

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

  async uploadImage(file: Express.Multer.File, bucket: string): Promise<{ storagePath: string; publicUrl: string }> {
    this.validateImage(file);

    const fileExt = file.originalname.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `${fileName}`;

    console.log(`[StorageService] Uploading to Supabase: bucket=${bucket}, path=${filePath}, mimetype=${file.mimetype}`);

    let { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (error && error.message === 'Bucket not found') {
      console.log(`[StorageService] Bucket '${bucket}' not found. Creating it...`);
      const { error: createError } = await supabase.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: MAX_FILE_SIZE
      });

      if (createError) {
        console.error(`[StorageService] Failed to create bucket:`, createError);
        const uploadError = new Error(`Failed to create bucket '${bucket}': ${createError.message}`);
        (uploadError as any).status = 500;
        throw uploadError;
      }

      // Retry upload
      console.log(`[StorageService] Bucket '${bucket}' created successfully. Retrying upload...`);
      const retryResponse = await supabase.storage
        .from(bucket)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: false
        });
        
      data = retryResponse.data;
      error = retryResponse.error;
    }

    if (error) {
      console.error(`[StorageService] Supabase upload error:`, error);
      const uploadError = new Error(`Failed to upload to Supabase: ${error.message}`);
      (uploadError as any).status = 500;
      throw uploadError;
    }

    console.log(`[StorageService] Upload completed, getting public URL...`);
    const publicUrl = this.getPublicUrl(filePath, bucket);

    return { storagePath: filePath, publicUrl };
  },

  getPublicUrl(storagePath: string, bucket: string): string {
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return data.publicUrl;
  },

  async deleteImage(storagePath: string, bucket: string): Promise<void> {
    const { error } = await supabase.storage.from(bucket).remove([storagePath]);
    
    if (error) {
      console.error(`Failed to delete image ${storagePath} from bucket ${bucket}:`, error);
      // We log but don't strictly throw to prevent blocking record deletion if the file is already gone
    }
  },

  async deleteImagesByUrls(urls: string[]): Promise<void> {
    if (!urls || urls.length === 0) return;

    // Fetch media records to get storage_path and bucket
    const { data: mediaRecords, error: fetchError } = await supabase
      .from('media')
      .select('id, storage_path, bucket')
      .in('public_url', urls);

    if (fetchError) {
      console.error('Failed to fetch media records for deletion by URLs:', fetchError);
      return;
    }

    if (!mediaRecords || mediaRecords.length === 0) return;

    const idsToDelete: string[] = [];

    // Group by bucket for efficient deletion
    const recordsByBucket = mediaRecords.reduce((acc: any, record: any) => {
      if (record.storage_path && record.bucket) {
        if (!acc[record.bucket]) acc[record.bucket] = [];
        acc[record.bucket].push(record.storage_path);
        idsToDelete.push(record.id);
      }
      return acc;
    }, {});

    // Delete from Supabase Storage
    for (const bucket of Object.keys(recordsByBucket)) {
      const paths = recordsByBucket[bucket];
      if (paths.length > 0) {
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) {
          console.error(`Failed to bulk delete images from bucket ${bucket}:`, error);
        }
      }
    }

    // Delete from Media Table
    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase.from('media').delete().in('id', idsToDelete);
      if (deleteError) {
        console.error('Failed to delete media records:', deleteError);
      }
    }
  }
};
