import { Request, Response, NextFunction } from 'express';
import * as bannersRepo from '../database/repos/banners';
import { triggerStorefrontRevalidation } from '../services/revalidateService';

export const getBanners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await bannersRepo.listBanners(true);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const adminGetBanners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await bannersRepo.listBanners(false);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const createBanner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await bannersRepo.insertBanner(req.body);
    await triggerStorefrontRevalidation('banner:create');
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateBanner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await bannersRepo.updateBanner(id as string, req.body);
    if (!data) throw new Error('Banner not found');
    await triggerStorefrontRevalidation('banner:update');
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteBanner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await bannersRepo.deleteBanner(id as string);
    await triggerStorefrontRevalidation('banner:delete');
    res.json({ success: true, message: 'Banner deleted successfully' });
  } catch (error) {
    next(error);
  }
};
