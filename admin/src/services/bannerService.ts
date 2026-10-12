import { apiClient } from '../api/apiClient';

export interface Banner {
  id?: string;
  heading: string;
  subheading?: string;
  cta_text?: string;
  cta_link?: string;
  image_url: string;
  display_order: number;
  is_active: boolean;
  created_at?: string;
}

class BannerService {
  async getBanners(): Promise<Banner[]> {
    const response = await apiClient.get('/banners/admin');
    const data = response?.data !== undefined ? response.data : response;
    return Array.isArray(data) ? data : (data?.data || []);
  }

  async createBanner(data: Partial<Banner>): Promise<Banner> {
    const response = await apiClient.post('/banners', data);
    return response?.data?.data || response?.data || response;
  }

  async updateBanner(id: string, data: Partial<Banner>): Promise<Banner> {
    const response = await apiClient.patch(`/banners/${id}`, data);
    return response?.data?.data || response?.data || response;
  }

  async deleteBanner(id: string): Promise<void> {
    await apiClient.delete(`/banners/${id}`);
  }
}

export const bannerService = new BannerService();
export default bannerService;
