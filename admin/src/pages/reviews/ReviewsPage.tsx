import React, { useState, useEffect, useRef } from 'react'
import { Star, Check, X as RejectIcon, Trash2, MessageCircle, RefreshCw, Sparkles, Edit } from 'lucide-react'
import { reviewService } from '../../services/reviewService'
import { Review, ReviewStatus } from '../../types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatDate } from '@meruveda/shared'
import { Modal } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export const ReviewsPage: React.FC = () => {
  const [reviews, setReviews] = useState<Review[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Tracks which review id currently has an action in flight so its buttons
  // disable (double-clicks otherwise look like "nothing happens").
  const [actingId, setActingId] = useState<string | null>(null)
  // Ref mirror of actingId: state updates are async, so rapid clicks in the
  // same tick would all see a stale `null` and fire duplicates. The ref
  // updates synchronously and is the actual double-click guard.
  const actingRef = useRef<string | null>(null)

  const beginActing = (id: string): boolean => {
    if (actingRef.current) return false
    actingRef.current = id
    setActingId(id)
    return true
  }

  const endActing = () => {
    actingRef.current = null
    setActingId(null)
  }

  const actionError = (err: any, fallback: string) =>
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    fallback

  // Reply Modal
  const [isReplyOpen, setIsReplyOpen] = useState(false)
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [replyText, setReplyText] = useState('')

  // Edit Modal
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editRating, setEditRating] = useState(5)
  const [editComment, setEditComment] = useState('')

  const openEdit = (review: Review) => {
    setSelectedReview(review)
    setEditRating(review.rating)
    setEditComment(review.body || '')
    setIsEditOpen(true)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedReview) return

    try {
      await reviewService.updateReview(selectedReview.id, {
        rating: editRating,
        body: editComment
      })
      toast.success('Review updated successfully!')
      setIsEditOpen(false)
      fetchReviews()
    } catch (err) {
      toast.error(actionError(err, 'Failed to update review'))
    }
  }

  const fetchReviews = async () => {
    setIsLoading(true)
    try {
      const data = await reviewService.getReviews()
      setReviews(data)
    } catch (err) {
      toast.error('Failed to load reviews')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchReviews()
  }, [])

  const handleStatusUpdate = async (id: string, status: ReviewStatus) => {
    if (!beginActing(id)) return
    try {
      await reviewService.updateReviewStatus(id, status)
      toast.success(`Review ${status}`)
      await fetchReviews()
    } catch (err) {
      toast.error(actionError(err, 'Operation failed'))
    } finally {
      endActing()
    }
  }

  const handleDelete = async (id: string) => {
    if (!beginActing(id)) return
    try {
      await reviewService.deleteReview(id)
      toast.success('Review deleted')
      await fetchReviews()
    } catch (err) {
      toast.error(actionError(err, 'Failed to delete review'))
    } finally {
      endActing()
    }
  }

  const openReply = (review: Review) => {
    setSelectedReview(review)
    setReplyText(review.reply || '')
    setIsReplyOpen(true)
  }

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedReview || !replyText) return

    try {
      await reviewService.replyToReview(selectedReview.id, replyText)
      toast.success('Reply saved and review approved!')
      setIsReplyOpen(false)
      fetchReviews()
    } catch (err) {
      toast.error(actionError(err, 'Failed to save reply'))
    }
  }

  const handleFeatureToggle = async (id: string, currentlyFeatured: boolean) => {
    if (!beginActing(id)) return
    try {
      await reviewService.featureReview(id, !currentlyFeatured)
      toast.success(currentlyFeatured ? 'Removed from homepage' : 'Now featured on homepage!')
      await fetchReviews()
    } catch (err) {
      toast.error(actionError(err, 'Failed to update feature status'), { duration: 6000 })
    } finally {
      endActing()
    }
  }

  // Analytics Metrics
  const approvedList = reviews.filter((r) => r.status === 'approved')
  const avgRating =
    approvedList.length > 0
      ? (approvedList.reduce((sum, r) => sum + r.rating, 0) / approvedList.length).toFixed(1)
      : '0.0'

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="page-title">Reviews & Ratings</h1>
        <p className="text-sm text-slate-500">Approve user feedback, write support replies, and track overall sentiment.</p>
      </div>

      {/* Sentiment Overview Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Average Rating</span>
            <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 flex items-center gap-1.5">
              {avgRating} <Star className="h-6 w-6 text-amber-500 fill-amber-500" />
            </h3>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-600 rounded-2xl">
            <Star className="h-6 w-6" />
          </div>
        </div>

        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Pending Approvals</span>
            <h3 className="text-3xl font-extrabold text-amber-600 mt-1">
              {reviews.filter((r) => r.status === 'pending').length}
            </h3>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-600 rounded-2xl">
            <MessageCircle className="h-6 w-6" />
          </div>
        </div>

        <div className="card p-6 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase">Total Approved</span>
            <h3 className="text-3xl font-extrabold text-green-600 mt-1">{approvedList.length}</h3>
          </div>
          <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-600 rounded-2xl">
            <Check className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Reviews feed */}
      <div className="card p-6 space-y-6">
        <h3 className="section-title">Customer Feedback Feed</h3>

        <div className="space-y-6 divide-y divide-slate-100 dark:divide-slate-800">
          {isLoading ? (
            <div className="py-6 text-center text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto text-slate-350" />
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No customer reviews submitted.</p>
          ) : (
            reviews.map((rev, idx) => (
              <div key={rev.id} className={`pt-6 ${idx === 0 ? 'pt-0' : ''} space-y-3`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">{rev.customerName}</span>
                      <StatusBadge status={rev.status} />
                    </div>
                    <p className="text-xs text-slate-400">
                      Reviewed <span className="font-semibold text-slate-655 dark:text-slate-350">{rev.productName}</span> on{' '}
                      {formatDate(rev.createdAt)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1.5">
                    {rev.status === 'approved' && (
                      <button
                        onClick={() => handleFeatureToggle(rev.id, !!(rev as any).isFeatured)}
                        disabled={actingId === rev.id}
                        className={`p-1.5 rounded-lg border dark:border-slate-800 transition-colors disabled:opacity-40 ${
                          (rev as any).isFeatured
                            ? 'bg-amber-50 text-amber-500 hover:bg-amber-100'
                            : 'hover:bg-amber-50 text-slate-400 hover:text-amber-500'
                        }`}
                        title={(rev as any).isFeatured ? 'Remove from homepage' : 'Feature on Website Homepage'}
                      >
                        <Sparkles className="h-4 w-4" />
                      </button>
                    )}
                    {rev.status === 'pending' && (
                      <button
                        onClick={() => handleStatusUpdate(rev.id, 'approved')}
                        disabled={actingId === rev.id}
                        className="p-1.5 hover:bg-green-50 text-slate-400 hover:text-green-600 rounded-lg border dark:border-slate-800 disabled:opacity-40"
                        title="Approve Review"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    {rev.status === 'pending' && (
                      <button
                        onClick={() => handleStatusUpdate(rev.id, 'rejected')}
                        disabled={actingId === rev.id}
                        className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg border dark:border-slate-800 disabled:opacity-40"
                        title="Reject Review"
                      >
                        <RejectIcon className="h-4 w-4" />
                      </button>
                    )}
                     <button
                      onClick={() => openReply(rev)}
                      className="p-1.5 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded-lg border dark:border-slate-800"
                      title="Write Reply"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openEdit(rev)}
                      className="p-1.5 hover:bg-slate-50 text-slate-400 hover:text-slate-650 rounded-lg border dark:border-slate-800"
                      title="Edit Review Rating/Comment"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rev.id)}
                      disabled={actingId === rev.id}
                      className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg border dark:border-slate-800 disabled:opacity-40"
                      title="Delete Review"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Rating stars & comment */}
                <div className="space-y-1.5">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${
                          i < rev.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  {rev.title && <h4 className="font-bold text-slate-900 dark:text-white text-sm">{rev.title}</h4>}
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{rev.body}</p>
                </div>

                {/* Admin Reply box */}
                {rev.reply && (
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border dark:border-slate-800 text-xs">
                    <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      🛡️ Store Owner Response
                    </p>
                    <p className="text-slate-600 dark:text-slate-350 mt-1">{rev.reply}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Reply Modal */}
      <Modal
        isOpen={isReplyOpen}
        onClose={() => setIsReplyOpen(false)}
        title={`Reply to Review — ${selectedReview?.customerName}`}
      >
        <form onSubmit={handleReplySubmit} className="space-y-4">
          <div className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
            <p className="font-bold">Original Review:</p>
            <p className="italic mt-1">&ldquo;{selectedReview?.body}&rdquo;</p>
          </div>

          <div>
            <label className="label">Response Message</label>
            <textarea
              required
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="e.g. Thank you for sharing your feedback, Rahul! We are glad you liked our product..."
              className="input h-32"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => setIsReplyOpen(false)}
              className="btn-outline px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-xs">
              Save Reply
            </button>
          </div>
        </form>
      </Modal>
      {/* Edit Review Modal */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title={`Edit Review — ${selectedReview?.customerName}`}
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="label">Rating (1 to 5 Stars)</label>
            <div className="flex gap-1.5 mt-1.5">
              {[1, 2, 3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setEditRating(num)}
                  className="p-1 hover:scale-110 transition-transform"
                >
                  <Star
                    className={`h-7 w-7 ${
                      num <= editRating ? 'text-amber-400 fill-amber-400' : 'text-slate-200 dark:text-slate-700'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Review Comment</label>
            <textarea
              required
              value={editComment}
              onChange={(e) => setEditComment(e.target.value)}
              placeholder="Update review comment..."
              className="input h-32"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => setIsEditOpen(false)}
              className="btn-outline px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-xs">
              Save Changes
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
export default ReviewsPage
