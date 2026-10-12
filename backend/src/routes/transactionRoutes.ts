import { Router } from 'express';
import { getTransactions, createTransaction, updateTransactionStatus } from '../controllers/transactionsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// Writing transactions is admin-only: a customer-authenticated caller could
// otherwise insert a "successful" payment row (or a refund) for any order.
router.use(requireAuth as any, requireAdmin as any);
router.post('/', createTransaction as any);
router.get('/', getTransactions as any);
router.patch('/:id/status', updateTransactionStatus as any);

export default router;
