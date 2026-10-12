import { Router } from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct } from '../controllers/productsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

// Public routes
router.get('/', getProducts as any);
router.get('/:id', getProductById as any);

// Protected Admin Routes
router.post('/', requireAuth as any, requireAdmin as any, createProduct as any);
router.patch('/:id', requireAuth as any, requireAdmin as any, updateProduct as any);
router.delete('/:id', requireAuth as any, requireAdmin as any, deleteProduct as any);

export default router;
