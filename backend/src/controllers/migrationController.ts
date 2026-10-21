import { Request, Response } from 'express';
import { query } from '../database/db';

/**
 * One-time migration endpoint to make orders.user_id nullable on production.
 * DELETE THIS AFTER USE.
 */
export const runMigration007 = async (req: Request, res: Response) => {
  try {
    // Verify a secret token to prevent accidental execution
    const token = req.headers['x-migration-token'];
    const expectedToken = process.env.MIGRATION_SECRET;
    console.log('[Migration] Token received:', token);
    console.log('[Migration] Expected token:', expectedToken ? 'SET' : 'NOT SET');
    if (token !== expectedToken) {
      return res.status(403).json({ error: 'Forbidden', debug: { received: token?.slice(0, 4), expected: expectedToken ? 'SET' : 'NOT SET' } });
    }

    await query(`
      ALTER TABLE public.orders
        ALTER COLUMN user_id DROP NOT NULL;
    `);

    res.json({ success: true, message: 'Migration 007 applied: orders.user_id is now nullable' });
  } catch (error: any) {
    console.error('Migration 007 failed:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Migration failed' });
  }
};