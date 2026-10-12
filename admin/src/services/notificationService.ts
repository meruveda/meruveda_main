import { apiClient } from '../api/apiClient';
import { Notification, PaginationParams, PaginatedResponse } from '../types';

class NotificationService {
  async getNotifications(params?: PaginationParams): Promise<Notification[]> {
    return apiClient.get('/notifications', { params });
  }

  async markAsRead(id: string): Promise<Notification> {
    return apiClient.patch(`/notifications/${id}/read`);
  }

  async deleteNotification(id: string): Promise<void> {
    await apiClient.delete(`/notifications/${id}`);
  }

  async markAllAsRead(): Promise<void> {
    await apiClient.post('/notifications/read-all');
  }
}

export const notificationService = new NotificationService();
export default notificationService;
