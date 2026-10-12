import { apiClient } from '../api/apiClient';
import { ActivityLog, PaginationParams } from '../types';

const mapLog = (raw: any): ActivityLog => {
  const user = raw?.users || {};
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  const details = raw?.details;
  return {
    id: raw.id,
    adminId: raw.user_id || '',
    adminName: fullName || user.email || raw.user_name || 'System',
    action: raw.action,
    module: raw.entity_type || 'customers',
    details:
      typeof details === 'string'
        ? details
        : details && typeof details === 'object'
          ? JSON.stringify(details)
          : undefined,
    createdAt: raw.created_at
  };
};

class ActivityService {
  async getLogs(params?: PaginationParams & { module?: string; action?: string }): Promise<ActivityLog[]> {
    // Backend mounts this at /api/activity-logs (admin-only).
    const response = await apiClient.get('/activity-logs', { params });
    const list = Array.isArray(response) ? response : (response?.data || []);
    return list.map(mapLog);
  }
}

export const activityService = new ActivityService();
export default activityService;
