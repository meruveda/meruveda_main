import { Router } from 'express';
import { getReviews, getMyReviews, createReview, updateReviewStatus, deleteReview, featureReview, getFeaturedReviews, updateReview } from '../controllers/reviewsController';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', getReviews as any);
router.get('/featured', getFeaturedReviews as any); // Public - for homepage display

router.use(requireAuth as any);
router.get('/my', getMyReviews as any); // Customer feedback history (must stay before admin-only block)
router.post('/', createReview as any); // Customers can post

// Owner-or-admin (ownership enforced inside the controller): shoppers can
// edit/delete their own reviews, admins can manage any review.
router.patch('/:id', updateReview as any);
router.delete('/:id', deleteReview as any);

router.use(requireAdmin as any);
router.patch('/:id/status', updateReviewStatus as any);
router.patch('/:id/feature', featureReview as any);

export default router;
