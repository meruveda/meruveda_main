import { Router } from 'express';
import { getBlogs, getBlogBySlug, createBlog, updateBlog, deleteBlog } from '../controllers/blogController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', getBlogs as any);
router.get('/:slug', getBlogBySlug as any);

router.use(requireAuth as any, requireAdmin as any);
router.post('/', createBlog as any);
router.patch('/:id', updateBlog as any);
router.delete('/:id', deleteBlog as any);

export default router;
