import { apiClient } from '../api/apiClient';
import { Coupon } from '../types';

class CouponService {
  async getCoupons(): Promise<Coupon[]> {
    return apiClient.get('/coupons');
  }

  async getCouponById(id: string): Promise<Coupon> {
    return apiClient.get(`/coupons/${id}`);
  }

  async createCoupon(data: Partial<Coupon>): Promise<Coupon> {
    return apiClient.post('/coupons', data);
  }

  async updateCoupon(id: string, data: Partial<Coupon>): Promise<Coupon> {
    return apiClient.patch(`/coupons/${id}`, data);
  }

  async deleteCoupon(id: string): Promise<void> {
    await apiClient.delete(`/coupons/${id}`);
  }

  async updateCouponStatus(id: string, active: boolean): Promise<Coupon> {
    return apiClient.patch(`/coupons/${id}`, { isActive: active });
  }
}

export const couponService = new CouponService();
export default couponService;
