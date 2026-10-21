import { Router } from 'express';
import { runMigration007 } from '../controllers/migrationController';

const router = Router();

/**
 * One-time migration endpoint.
 * DELETE THIS AFTER USE.
 */
router.post('/migrate-007', runMigration007 as any);

export default router;