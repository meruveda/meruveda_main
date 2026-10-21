import { Request, Response, NextFunction } from 'express';
import * as wishlistRepo from '../database/repos/wishlist';
import * as productsRepo from '../database/repos/products';

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

    if (!product_id) {
      return res.status(400).json({ error: { message: 'product_id is required' } });
    }

    // `product_id` may arrive as a slug; wishlist_items.product_id is a uuid,
    // so resolve it first — never bind a slug to a uuid comparison.
    const productId = await productsRepo.resolveProductId(String(product_id));
    if (!productId) {
      return res.status(404).json({ error: { message: 'Product not found' } });
    }

    const existing = await wishlistRepo.findItem(userId, productId);

    if (existing) {
      // Remove
      await wishlistRepo.deleteItem(existing.id);
      res.json({ action: 'removed', product_id: productId });
    } else {
      // Add
      const data = await wishlistRepo.insertItem({ user_id: userId, product_id: productId });
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
