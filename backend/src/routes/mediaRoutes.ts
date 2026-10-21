import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { uploadMedia, getMedia, deleteMedia } from '../controllers/mediaController';
import { requireAuth, requireAdmin } from '../middleware/auth';

// Use memory storage for the buffer upload to R2
const storage = multer.memoryStorage();
const upload = multer({ storage });
const router = Router();

router.use(requireAuth as any, requireAdmin as any);

router.get('/', getMedia as any);
router.post('/upload', upload.single('file'), uploadMedia as any);
router.delete('/:id', deleteMedia as any);

/**
 * Turn a multer/platform failure into a clear JSON answer.
 *
 * Without this, a request that is too big for the platform's body limit
 * answered with a bare, unreadable 500 and the admin saw "Request failed with
 * status code 500" with no idea what to do.
 */
router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();

  const code = String(err.code || '');
  const message = String(err.message || '');

  // multer: the file exceeded the limit we configured.
  if (code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: {
        message:
          'That image is too large. The maximum is 4 MB - please resize or compress it and try again.',
        code: 'FILE_TOO_LARGE',
      },
    });
  }

  // The platform rejected the body before the function even ran.
  if (/FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(message) || err.status === 413) {
    return res.status(413).json({
      error: {
        message:
          'That image is too large to upload. The maximum is 4 MB - please resize or compress it and try again.',
        code: 'FILE_TOO_LARGE',
      },
    });
  }

  // A malformed multipart body.
  if (code === 'LIMIT_UNEXPECTED_FILE' || /Unexpected field|boundary/i.test(message)) {
    return res.status(400).json({
      error: { message: 'That upload was malformed. Please try again.', code: 'MALFORMED_UPLOAD' },
    });
  }

  next(err);
});

export default router;
