import { Router } from 'express';
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '../controllers/addressController';
import { requireAuth, requireCustomerSession } from '../middleware/auth';

const router = Router();

// The address book is always personal data: no route is public. A checkout
// session gets its own book (the rows it created); a real account gets its
// own.
router.use(requireAuth as any, requireCustomerSession as any);

router.get('/', listAddresses as any);
router.post('/', createAddress as any);
router.patch('/:id', updateAddress as any);
router.post('/:id/default', setDefaultAddress as any);
router.delete('/:id', deleteAddress as any);

export default router;