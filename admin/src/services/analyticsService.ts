import { apiClient } from '../api/apiClient';
import { DashboardStats } from '../types';

class AnalyticsService {
  async getDashboardStats(): Promise<DashboardStats> {
    return apiClient.get('/analytics/dashboard');
  }

  async getSummary(): Promise<any> {
    return apiClient.get('/analytics/summary');
  }

  async getVisitorStats(): Promise<any> {
    return apiClient.get('/analytics/visitors');
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
