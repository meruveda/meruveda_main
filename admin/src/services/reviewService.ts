import { apiClient } from '../api/apiClient';
import { Review, PaginationParams, PaginatedResponse } from '../types';

class ReviewService {
  async getReviews(params?: PaginationParams & { status?: string, productId?: string }): Promise<Review[]> {
    const response = await apiClient.get('/reviews', { params });
    const rawData = Array.isArray(response) ? response : (response?.data || []);
    return rawData.map((r: any) => ({
      ...r,
      body: r.comment || r.body || '',
      reply: r.reply || '',
      createdAt: r.createdAt || r.created_at || '',
      // The API returns snake_case; the Reviews page reads the camelCase flag.
      isFeatured: Boolean(r.isFeatured ?? r.is_featured),
      customerName: r.users ? `${r.users.first_name || ''} ${r.users.last_name || ''}`.trim() || r.users.email || 'Customer' : 'Customer',
      productName: r.products?.name || 'Product'
    }));
  }

  async updateReviewStatus(id: string, status: string): Promise<Review> {
    return apiClient.patch(`/reviews/${id}/status`, { status });
  }

  async replyToReview(id: string, reply: string): Promise<Review> {
    return this.updateReview(id, { reply, status: 'approved' });
  }

  async featureReview(id: string, featured: boolean): Promise<Review> {
    return apiClient.patch(`/reviews/${id}/feature`, { featured });
  }

  async updateReview(id: string, data: Partial<Review>): Promise<Review> {
    const payload: any = { ...data };
    if (data.body !== undefined) {
      payload.comment = data.body;
      delete payload.body;
    }
    return apiClient.patch(`/reviews/${id}`, payload);
  }

  async deleteReview(id: string): Promise<void> {
    await apiClient.delete(`/reviews/${id}`);
  }
}

export const reviewService = new ReviewService();
export default reviewService;
