import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';
import { hasColumn } from '../services/schemaGuard';
import { verifyToken } from '../utils/jwt';

const MIGRATION_HINT =
  'Migration 006_missing_columns.sql not applied. Run it in the Supabase SQL editor (backend/database/deltas/), then retry.';

function requesterIsAdmin(req: Request): boolean {
  return req.user?.role === 'admin';
}

/** Best-effort optional auth: lets the public list tell admins apart from shoppers. */
function bearerIsAdmin(req: Request): boolean {
  if (requesterIsAdmin(req)) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  try {
    const payload = verifyToken(header.slice(7));
    return (payload as any)?.role === 'admin';
  } catch {
    return false;
  }
}

export const getReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId, status } = req.query;

    let query = supabase.from('reviews').select('*, users(first_name, last_name), products(id, name)', { count: 'exact' });

    if (productId) query = query.eq('product_id', productId);
    // The public list must never leak the moderation queue: only admins may
    // request non-approved statuses. Shoppers always see approved reviews.
    if (status) {
      if (String(status) === 'approved' || bearerIsAdmin(req)) {
        query = query.eq('status', String(status));
      } else {
        query = query.eq('status', 'approved');
      }
    } else if (!bearerIsAdmin(req)) {
      query = query.eq('status', 'approved');
    }

    const { data, count, error } = await query;
    if (error) throw error;
    res.json({ data, total: count });
  } catch (error) {
    next(error);
  }
};

/** Authenticated customer's own feedback history (profile page). */
export const getMyReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    const { data, error } = await supabase
      .from('reviews')
      .select('*, products(id, name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (error) {
    next(error);
  }
};

export const createReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { product_id, rating, comment } = req.body || {};

    if (!product_id) {
      return res.status(400).json({ error: { message: 'product_id is required' } });
    }
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: { message: 'rating must be an integer between 1 and 5' } });
    }
    if (comment !== undefined && typeof comment !== 'string') {
      return res.status(400).json({ error: { message: 'comment must be a string' } });
    }

    // Whitelist customer-writable fields only. Privileged columns
    // (is_featured, reply, user_id, status, id, timestamps) can never be
    // mass-assigned; new reviews always enter the moderation queue.
    const reviewData = { product_id, rating: ratingNum, comment: comment ?? null, user_id: userId, status: 'pending' };

    const { data, error } = await supabase.from('reviews').insert(reviewData).select().single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateReviewStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: { message: 'Invalid status. Use pending, approved or rejected.' } });
    }

    const { data, error } = await supabase.from('reviews').update({ status }).eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: { message: 'Review not found' } });
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    // Owner-or-admin: shoppers may delete their own reviews; admins may delete any.
    if (req.user?.role !== 'admin') {
      const { data: existing, error: fetchErr } = await supabase
        .from('reviews')
        .select('id, user_id')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: { message: 'Review not found' } });
      if (existing.user_id !== req.user?.id) {
        return res.status(403).json({ error: { message: 'Forbidden - You can only delete your own reviews' } });
      }
    }
    const { error } = await supabase.from('reviews').delete().eq('id', id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
export const featureReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { featured } = req.body;

    if (!(await hasColumn('reviews', 'is_featured'))) {
      return res.status(503).json({ error: { message: MIGRATION_HINT } });
    }

    const { data, error } = await supabase
      .from('reviews')
      .update({ is_featured: featured })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const getFeaturedReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // `reviews.is_featured` lands in delta 006. Until then fall back to the
    // newest approved reviews so the homepage testimonials are never empty.
    const featuredAvailable = await hasColumn('reviews', 'is_featured');

    let query = supabase
      .from('reviews')
      .select('*, users(first_name, last_name), products(id, name)')
      .eq('status', 'approved');
    if (featuredAvailable) query = query.eq('is_featured', true);

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(6);

    if (error) throw error;
    res.json({ data: data || [] });
  } catch (error) {
    next(error);
  }
};

export const updateReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { rating, comment, reply, status } = req.body;
    const updateData: any = {};
    if (rating !== undefined) {
      const ratingNum = Number(rating);
      if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: { message: 'rating must be an integer between 1 and 5' } });
      }
      updateData.rating = ratingNum;
    }
    if (comment !== undefined) {
      if (typeof comment !== 'string') {
        return res.status(400).json({ error: { message: 'comment must be a string' } });
      }
      updateData.comment = comment;
    }
    // `reply` and `status` are moderation actions: admins only.
    if (reply !== undefined || status !== undefined) {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: { message: 'Forbidden - Requires admin privileges' } });
      }
    }
    if (reply !== undefined) updateData.reply = reply;
    if (status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: { message: 'Invalid status. Use pending, approved or rejected.' } });
      }
      updateData.status = status;
    }
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: { message: 'Nothing to update' } });
    }

    // Owner-or-admin: shoppers may edit rating/comment of their own reviews.
    if (req.user?.role !== 'admin') {
      const { data: existing, error: fetchErr } = await supabase
        .from('reviews')
        .select('id, user_id')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: { message: 'Review not found' } });
      if (existing.user_id !== req.user?.id) {
        return res.status(403).json({ error: { message: 'Forbidden - You can only edit your own reviews' } });
      }
    }

    if (reply !== undefined && !(await hasColumn('reviews', 'reply'))) {
      return res.status(503).json({ error: { message: MIGRATION_HINT } });
    }

    const { data, error } = await supabase.from('reviews').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};
