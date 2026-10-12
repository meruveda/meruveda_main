import { Router } from 'express';
import { getCustomers, getCustomerById, updateCustomerStatus, updateCustomer, deleteCustomer, resetUserPassword, getCustomerAddresses, getCustomerCart } from '../controllers/customersController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(requireAuth as any, requireAdmin as any);

router.get('/', getCustomers as any);
router.get('/:id', getCustomerById as any);
router.get('/:id/addresses', getCustomerAddresses as any);
router.get('/:id/cart', getCustomerCart as any);
router.patch('/:id/status', updateCustomerStatus as any);
router.patch('/:id', updateCustomer as any);
router.post('/:id/reset-password', resetUserPassword as any);
router.delete('/:id', deleteCustomer as any);

export default router;
