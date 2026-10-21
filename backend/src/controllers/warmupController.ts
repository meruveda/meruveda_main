/**
 * Warm the backend.
 *
 * The backend is a separate Vercel service. Right after a deploy it is COLD,
 * and the storefront's server-side fetch can time out while the service boots.
 *
 * This endpoint touches the two things the storefront reads on its public
 * pages - the database and the products query - so the connection pool and the
 * module graph are already warm. It is public (it exposes nothing) and it is
 * what the warm-up cron hits.
 */
import { Request, Response, NextFunction } from 'express';
import { query } from '../database/db';

export const warmUp = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const startedAt = Date.now();
    // The same query the storefront's catalogue page runs.
    const products = await query(
      `SELECT count(*)::int AS c FROM products WHERE status = 'active'`,
    );
    res.json({
      status: 'warm',
      products: products[0]?.c ?? 0,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    next(error);
  }
};
