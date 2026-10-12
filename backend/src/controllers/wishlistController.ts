import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

export const getWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { data, error } = await supabase
      .from('wishlist_items')
      .select('*, products(*)')
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const toggleWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { product_id } = req.body;

    const { data: existing } = await supabase
      .from('wishlist_items')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', product_id)
      .single();

    if (existing) {
      // Remove
      const { error } = await supabase
        .from('wishlist_items')
        .delete()
        .eq('id', existing.id);
      if (error) throw error;
      res.json({ action: 'removed', product_id });
    } else {
      // Add
      const { data, error } = await supabase
        .from('wishlist_items')
        .insert({ user_id: userId, product_id })
        .select()
        .single();
      if (error) throw error;
      res.json({ action: 'added', data });
    }
  } catch (error) {
    next(error);
  }
};

export const removeFromWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const { error } = await supabase
      .from('wishlist_items')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
