import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';
import { storageService } from '../services/storageService';

export const uploadMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: 'No file uploaded' } });

    const bucket = req.body.folder || 'general-media'; // Default bucket if none provided

    console.log(`[MediaController] Uploading file: ${file.originalname} to bucket: ${bucket}`);
    
    const { storagePath, publicUrl } = await storageService.uploadImage(file, bucket);
    
    console.log(`[MediaController] Upload successful. Public URL: ${publicUrl}`);
    
    const mediaData = {
      filename: file.originalname,
      public_url: publicUrl,
      storage_path: storagePath,
      bucket: bucket,
      mime_type: file.mimetype,
      size: file.size
    };

    const { data, error } = await supabase.from('media').insert(mediaData).select().single();
    if (error) throw error;
    
    // For backward compatibility with the frontend that might expect `url` and `folder`
    res.status(201).json({ 
      data: {
        ...data,
        url: data.public_url,
        folder: data.bucket
      } 
    });
  } catch (error) {
    next(error);
  }
};

export const getMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { folder, type: search } = req.query;
    
    let query = supabase.from('media').select('*').order('created_at', { ascending: false });
    
    if (folder) {
      query = query.eq('bucket', folder);
    }

    if (search) {
      query = query.ilike('filename', `%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    
    // Add backward compatibility mapping
    const mappedData = data.map((item: any) => ({
      ...item,
      url: item.public_url,
      folder: item.bucket
    }));

    res.json({ data: mappedData });
  } catch (error) {
    next(error);
  }
};

export const deleteMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    // Get file info
    const { data: media, error: fetchError } = await supabase.from('media').select('storage_path, bucket').eq('id', id).single();
    if (fetchError) throw fetchError;
    
    if (media && media.storage_path && media.bucket) {
      await storageService.deleteImage(media.storage_path, media.bucket);
    }
    
    const { error } = await supabase.from('media').delete().eq('id', id);
    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
