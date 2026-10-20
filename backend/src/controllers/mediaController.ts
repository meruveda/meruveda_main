import { Request, Response, NextFunction } from 'express';
import * as mediaRepo from '../database/repos/media';
import { resolveMediaFolder, storageService } from '../services/storageService';

export const uploadMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: 'No file uploaded' } });

    // Never let a request pick an arbitrary bucket/prefix: allowlist only.
    const folder = resolveMediaFolder(req.body.folder);

    console.log(`[MediaController] Uploading file: ${file.originalname} to folder: ${folder}`);

    const { storagePath, publicUrl } = await storageService.uploadImage(file, folder);

    console.log(`[MediaController] Upload successful. Public URL: ${publicUrl}`);

    const mediaData = {
      filename: file.originalname,
      public_url: publicUrl,
      storage_path: storagePath,
      bucket: folder,
      mime_type: file.mimetype,
      size: file.size,
    };

    const data = await mediaRepo.insertMedia(mediaData);

    // For backward compatibility with the frontend that might expect `url` and `folder`
    res.status(201).json({
      data: {
        ...data,
        url: data.public_url,
        folder: data.bucket,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const folder = req.query.folder ? String(req.query.folder) : undefined;
    const search = req.query.type ? String(req.query.type) : undefined;

    const data = await mediaRepo.listMedia({ folder, search });

    const mappedData = data.map((item: any) => ({
      ...item,
      url: item.public_url,
      folder: item.bucket,
    }));

    res.json({ data: mappedData });
  } catch (error) {
    next(error);
  }
};

export const deleteMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const media = await mediaRepo.getMediaById(id as string);
    if (!media) {
      return res.status(404).json({ error: { message: 'Media not found' } });
    }

    if (media.storage_path) {
      await storageService.deleteImage(media.storage_path, media.bucket);
    }

    await mediaRepo.deleteMediaById(id as string);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
