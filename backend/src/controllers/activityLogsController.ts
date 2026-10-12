import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

export const getActivityLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { module: moduleFilter, action, limit } = req.query;

    let query = supabase
      .from('activity_logs')
      .select('*, users(first_name, last_name, email)')
      .order('created_at', { ascending: false });

    // `entity_type` holds the module name the admin UI filters by.
    if (moduleFilter && moduleFilter !== 'all') {
      query = query.eq('entity_type', String(moduleFilter));
    }
    if (action) {
      const safe = String(action).replace(/[%(),"]/g, '').trim().slice(0, 80);
      if (safe) query = query.ilike('action', `%${safe}%`);
    }

    query = query.limit(Math.min(500, Math.max(1, Number(limit) || 100)));

    const { data, error } = await query;
    if (error) throw error;
    res.json({ data: data || [], total: (data || []).length });
  } catch (error) {
    next(error);
  }
};

const LOGGABLE_MODULES = [
  'products',
  'categories',
  'inventory',
  'orders',
  'customers',
  'reviews',
  'coupons',
  'media',
  'blog',
  'settings',
  'admins'
];

export const logActivity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, module, entityType, entityId, details } = req.body || {};

    if (!action || !String(action).trim()) {
      return res.status(400).json({ error: { message: 'Activity log requires an action.' } });
    }

    // Whitelist the writable fields: `user_id` / `ip_address` always come from the
    // request itself so a client cannot forge entries against another account.
    const logData: any = {
      user_id: req.user?.id,
      ip_address: req.ip,
      action: String(action).trim().slice(0, 255)
    };

    const type = entityType || module;
    if (type && LOGGABLE_MODULES.includes(String(type))) logData.entity_type = String(type);
    if (entityId) logData.entity_id = entityId;
    if (details !== undefined) logData.details = details;

    const { data, error } = await supabase.from('activity_logs').insert(logData).select().single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};
