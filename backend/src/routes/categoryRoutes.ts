import { Router } from 'express';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../controllers/categoriesController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', getCategories as any);
router.post('/', requireAuth as any, requireAdmin as any, createCategory as any);
router.patch('/:id', requireAuth as any, requireAdmin as any, updateCategory as any);
router.delete('/:id', requireAuth as any, requireAdmin as any, deleteCategory as any);

export default router;
