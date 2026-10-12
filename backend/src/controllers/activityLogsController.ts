import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

export const getActivityLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*, users(first_name, last_name, email)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const logActivity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logData = req.body;
    logData.user_id = req.user?.id;
    logData.ip_address = req.ip;

    const { data, error } = await supabase.from('activity_logs').insert(logData).select().single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};
