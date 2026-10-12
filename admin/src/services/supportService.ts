import { apiClient } from '../api/apiClient';
import { SupportTicket, PaginationParams, PaginatedResponse } from '../types';

class SupportService {
  async getTickets(params?: PaginationParams & { status?: string }): Promise<SupportTicket[]> {
    const response = await apiClient.get('/support', { params });
    return Array.isArray(response) ? response : (response?.data || []);
  }

  async updateTicketStatus(id: string, status: string): Promise<SupportTicket> {
    return apiClient.patch(`/support/${id}/status`, { status });
  }

  async replyToTicket(id: string, message: string): Promise<SupportTicket> {
    return apiClient.post(`/support/${id}/reply`, { message });
  }
}

export const supportService = new SupportService();
export default supportService;
