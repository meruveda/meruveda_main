import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

export const getSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('*');

    if (error) throw error;
    
    // Convert array of key/values to a single object
    const settingsObject = data.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    res.json({ data: settingsObject });
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = req.body;
    
    for (const key of Object.keys(updates)) {
      const { data: existing } = await supabase.from('settings').select('id').eq('key', key).single();
      
      if (existing) {
        await supabase.from('settings').update({ value: updates[key] }).eq('id', existing.id);
      } else {
        await supabase.from('settings').insert({ key, value: updates[key] });
      }
    }

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    next(error);
  }
};
