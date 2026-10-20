import { Request, Response, NextFunction } from 'express';
import * as wishlistRepo from '../database/repos/wishlist';

export const getWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await wishlistRepo.listForUser(req.user?.id as string);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const toggleWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string;
    const { product_id } = req.body;

    const existing = await wishlistRepo.findItem(userId, product_id);

    if (existing) {
      // Remove
      await wishlistRepo.deleteItem(existing.id);
      res.json({ action: 'removed', product_id });
    } else {
      // Add
      const data = await wishlistRepo.insertItem({ user_id: userId, product_id });
      res.json({ action: 'added', data });
    }
  } catch (error) {
    next(error);
  }
};

export const removeFromWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await wishlistRepo.deleteItemForUser(req.user?.id as string, id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
