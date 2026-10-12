import { Router } from 'express';
import multer from 'multer';
import { uploadMedia, getMedia, deleteMedia } from '../controllers/mediaController';
import { requireAuth, requireAdmin } from '../middleware/auth';

// Use memory storage for buffer upload to Supabase
const storage = multer.memoryStorage();
const upload = multer({ storage });
const router = Router();

router.use(requireAuth as any, requireAdmin as any);

router.get('/', getMedia as any);
router.post('/upload', upload.single('file'), uploadMedia as any);
router.delete('/:id', deleteMedia as any);

export default router;
