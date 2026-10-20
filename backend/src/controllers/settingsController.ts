import { Request, Response, NextFunction } from 'express';
import * as settingsRepo from '../database/repos/settings';

export const getSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await settingsRepo.listSettings();

    // The route is public because the storefront needs store-level config
    // (logo, store hours, announcement). Per-user notification preferences are
    // stored in the same table under `notification_preferences_<userId>` and must
    // never leave through the public endpoint — they are only returned to the
    // signed-in admin.
    const isAdmin = req.user?.role === 'admin';
    const rows = data.filter((row: any) =>
      isAdmin || !String(row.key || '').startsWith('notification_preferences_')
    );

    // Convert array of key/values to a single object
    const settingsObject = rows.reduce((acc: any, curr: any) => {
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
      await settingsRepo.upsertSetting(key, updates[key]);
    }

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    next(error);
  }
};
