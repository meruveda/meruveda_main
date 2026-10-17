import { Router } from 'express';
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '../controllers/addressController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// The address book is always personal data: no route is public.
router.use(requireAuth as any);

router.get('/', listAddresses as any);
router.post('/', createAddress as any);
router.patch('/:id', updateAddress as any);
router.post('/:id/default', setDefaultAddress as any);
router.delete('/:id', deleteAddress as any);

export default router;