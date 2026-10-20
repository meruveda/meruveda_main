import { Request, Response, NextFunction } from 'express';
import * as cartRepo from '../database/repos/cart';

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

    const existing = await cartRepo.findItem(userId, product_id);

    let result;
    if (existing) {
      // Update quantity
      result = await cartRepo.updateQuantity(existing.id, existing.quantity + quantity);
      if (!result) throw new Error('Cart item not found');
    } else {
      // Insert new
      result = await cartRepo.insertItem({ user_id: userId, product_id, quantity });
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
