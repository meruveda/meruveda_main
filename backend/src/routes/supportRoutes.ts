import { Router } from 'express';
import { getTickets, getUserTickets, createTicket, updateTicketStatus, replyToTicket } from '../controllers/supportController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any);
router.get('/my', getUserTickets as any);
router.post('/', createTicket as any);

router.use(requireAdmin as any);
router.get('/', getTickets as any);
router.patch('/:id/status', updateTicketStatus as any);
router.post('/:id/reply', replyToTicket as any);

export default router;
