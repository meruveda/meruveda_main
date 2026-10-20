import { Router } from 'express';
import { getWishlist, toggleWishlist, removeFromWishlist } from '../controllers/wishlistController';
import { requireAuth, requireFullAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any, requireFullAuth as any);

router.get('/', getWishlist as any);
router.post('/toggle', toggleWishlist as any);
router.delete('/:id', removeFromWishlist as any);

export default router;
