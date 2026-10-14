import { apiClient } from '../api/apiClient';
import { DashboardStats } from '../types';

export interface TrafficStats {
  range: string
  totalViews: number
  uniqueSessions: number
  topPages: Array<{ path: string; views: number }>
  deviceSplit: Record<string, number>
  daily: Array<{ date: string; views: number }>
  /** Storefront funnel from analytics_events (all zero until that migration runs). */
  funnel: {
    productViews: number
    addToCart: number
    checkoutStarted: number
    purchases: number
    conversionRate: number
    checkoutCompletionRate: number
  }
  /** Most-viewed products in the window. */
  topProducts: Array<{ productId: string; name: string; views: number }>
  /** Orders placed in the window, split by payment method (from the orders table). */
  paymentSplit: { cod: number; payu: number }
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
