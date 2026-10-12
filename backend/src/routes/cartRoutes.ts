import { Router } from 'express';
import { getCart, addToCart, updateCartItem, removeFromCart, clearCart } from '../controllers/cartController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any);

router.get('/', getCart as any);
router.post('/', addToCart as any);
router.patch('/:id', updateCartItem as any);
router.delete('/:id', removeFromCart as any);
router.delete('/', clearCart as any);

export default router;
