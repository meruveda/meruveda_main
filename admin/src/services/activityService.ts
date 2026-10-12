import { apiClient } from '../api/apiClient';
import { ActivityLog, PaginationParams, PaginatedResponse } from '../types';

class ActivityService {
  async getLogs(params?: PaginationParams & { module?: string }): Promise<ActivityLog[]> {
    const response = await apiClient.get('/activity', { params });
    return Array.isArray(response) ? response : (response?.data || []);
  }
}

export const activityService = new ActivityService();
export default activityService;
