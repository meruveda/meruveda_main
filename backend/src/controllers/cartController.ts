import { Request, Response, NextFunction } from 'express';
import * as cartRepo from '../database/repos/cart';
import * as productsRepo from '../database/repos/products';

export const getCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await cartRepo.listForUser(req.user?.id as string);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const addToCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string;
    const { product_id, quantity } = req.body;

    if (!product_id) {
      return res.status(400).json({ error: { message: 'product_id is required' } });
    }

    // `product_id` may arrive as a slug (a stale localStorage cart, a
    // product-page link). cart_items.product_id is a uuid, so resolve first —
    // a slug bound directly answers `invalid input syntax for type uuid`.
    const productId = await productsRepo.resolveProductId(String(product_id));
    if (!productId) {
      return res.status(404).json({ error: { message: 'Product not found' } });
    }

    const existing = await cartRepo.findItem(userId, productId);

    let result;
    if (existing) {
      // Update quantity
      result = await cartRepo.updateQuantity(existing.id, existing.quantity + quantity);
      if (!result) throw new Error('Cart item not found');
    } else {
      // Insert new
      result = await cartRepo.insertItem({ user_id: userId, product_id: productId, quantity });
    }

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};

export const updateCartItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    const data = await cartRepo.updateForUser(req.user?.id as string, id as string, { quantity });
    if (!data) throw new Error('Cart item not found');
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const removeFromCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await cartRepo.removeForUser(req.user?.id as string, id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const clearCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await cartRepo.clearForUser(req.user?.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
