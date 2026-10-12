import { apiClient } from '../api/apiClient';
import { DashboardStats } from '../types';

export const dashboardService = {
  getStats: async (): Promise<DashboardStats> => {
    return apiClient.get('/analytics/dashboard');
  },
}
