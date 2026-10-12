import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

const mapCouponToCamelCase = (dbCoupon: any) => {
  const {
    active,
    expires_at,
    min_purchase,
    usage_limit,
    max_discount,
    used_count,
    created_at,
    ...rest
  } = dbCoupon;
  return {
    ...rest,
    isActive: active,
    expiresAt: expires_at,
    type: dbCoupon.type === 'fixed' ? 'flat' : dbCoupon.type,
    minPurchase: min_purchase,
    usageLimit: usage_limit,
    maxDiscount: max_discount,
    usedCount: used_count,
    createdAt: created_at,
  };
};

export const getCoupons = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase.from('coupons').select('*');
    if (error) throw error;
    res.json({ data: data.map(mapCouponToCamelCase) });
  } catch (error) {
    next(error);
  }
};

export const validateCoupon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, orderValue } = req.body;
    const { data, error } = await supabase.from('coupons').select('*').eq('code', code.toUpperCase()).single();
    
    if (error || !data) return res.status(404).json({ error: { message: 'Invalid coupon code' } });
    if (!data.active) return res.status(400).json({ error: { message: 'Coupon is inactive' } });
    if (data.expires_at && new Date(data.expires_at) < new Date()) return res.status(400).json({ error: { message: 'Coupon expired' } });
    if (data.min_purchase > orderValue) return res.status(400).json({ error: { message: `Minimum order value must be ${data.min_purchase}` } });

    res.json({ data: mapCouponToCamelCase(data) });
  } catch (error) {
    next(error);
  }
};

export const createCoupon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const couponData = { ...req.body };
    if (couponData.code) couponData.code = couponData.code.toUpperCase();
    
    // Map camelCase to snake_case for Supabase
    if (couponData.expiresAt !== undefined) {
      couponData.expires_at = couponData.expiresAt;
      delete couponData.expiresAt;
    }
    // We don't need to rename type to discount_type, DB has type
    if (couponData.type !== undefined && couponData.type === 'flat') {
      couponData.type = 'fixed';
    }
    if (couponData.minPurchase !== undefined) {
      couponData.min_purchase = couponData.minPurchase;
      delete couponData.minPurchase;
    }
    if (couponData.usageLimit !== undefined) {
      couponData.usage_limit = couponData.usageLimit;
      delete couponData.usageLimit;
    }
    if (couponData.maxDiscount !== undefined) {
      couponData.max_discount = couponData.maxDiscount;
      delete couponData.maxDiscount;
    }
    if (couponData.isActive !== undefined) {
      couponData.active = couponData.isActive;
      delete couponData.isActive;
    }
    if (couponData.usedCount !== undefined) {
      couponData.used_count = couponData.usedCount;
      delete couponData.usedCount;
    }
    
    const { data, error } = await supabase.from('coupons').insert(couponData).select().single();
    if (error) throw error;
    res.status(201).json({ data: mapCouponToCamelCase(data) });
  } catch (error) {
    next(error);
  }
};

export const updateCoupon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const updates: any = { ...req.body };
    
    // Map camelCase to snake_case
    if (updates.isActive !== undefined) {
      updates.active = updates.isActive;
      delete updates.isActive;
    }
    if (updates.code) updates.code = updates.code.toUpperCase();
    if (updates.expiresAt !== undefined) {
      updates.expires_at = updates.expiresAt;
      delete updates.expiresAt;
    }
    if (updates.type !== undefined && updates.type === 'flat') {
      updates.type = 'fixed';
    }
    if (updates.minPurchase !== undefined) {
      updates.min_purchase = updates.minPurchase;
      delete updates.minPurchase;
    }
    if (updates.usageLimit !== undefined) {
      updates.usage_limit = updates.usageLimit;
      delete updates.usageLimit;
    }
    if (updates.maxDiscount !== undefined) {
      updates.max_discount = updates.maxDiscount;
      delete updates.maxDiscount;
    }
    if (updates.usedCount !== undefined) {
      updates.used_count = updates.usedCount;
      delete updates.usedCount;
    }

    const { data, error } = await supabase.from('coupons').update(updates).eq('id', id).select().single();
    if (error) throw error;
    res.json({ data: mapCouponToCamelCase(data) });
  } catch (error) {
    next(error);
  }
};

export const deleteCoupon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('coupons').delete().eq('id', id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
