import { Router } from 'express';
import { getTransactions, createTransaction, updateTransactionStatus } from '../controllers/transactionsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any);
router.post('/', createTransaction as any);

router.use(requireAdmin as any);
router.get('/', getTransactions as any);
router.patch('/:id/status', updateTransactionStatus as any);

export default router;
