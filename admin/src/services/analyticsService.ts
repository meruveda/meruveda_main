import { apiClient } from '../api/apiClient';
import { DashboardStats } from '../types';

export interface TrafficStats {
  range: string
  totalViews: number
  uniqueSessions: number
  topPages: Array<{ path: string; views: number }>
  deviceSplit: Record<string, number>
  daily: Array<{ date: string; views: number }>
}

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

  /** First-party pageview report (range: '7d' | '30d'). */
  async getTraffic(range: '7d' | '30d' = '7d'): Promise<TrafficStats> {
    return apiClient.get(`/analytics/traffic?range=${range}`);
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
