import { apiClient } from '../api/apiClient';
import { SupportTicket, PaginationParams } from '../types';

const mapTicket = (raw: any): SupportTicket => {
  const user = raw?.users || {};
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return {
    id: raw.id,
    ticketNumber: raw.ticket_number || (raw.id ? `TKT-${String(raw.id).replace(/-/g, '').slice(0, 8).toUpperCase()}` : 'TKT-????????'),
    customerId: raw.user_id,
    customerName: fullName || user.email || raw.user_name || 'Guest Customer',
    customerEmail: user.email || raw.user_email || '',
    subject: raw.subject,
    message: raw.message,
    reply: raw.reply || '',
    status: raw.status,
    priority: raw.priority,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  };
};

class SupportService {
  async getTickets(params?: PaginationParams & { status?: string; priority?: string; search?: string }): Promise<SupportTicket[]> {
    const response = await apiClient.get('/support', { params });
    const list = Array.isArray(response) ? response : (response?.data || []);
    return list.map(mapTicket);
  }

  async updateTicketStatus(id: string, status: string): Promise<SupportTicket> {
    const response: any = await apiClient.patch(`/support/${id}/status`, { status });
    return mapTicket(response?.data || response);
  }

  async replyToTicket(id: string, message: string): Promise<SupportTicket> {
    const response: any = await apiClient.post(`/support/${id}/reply`, { message });
    return mapTicket(response?.data || response);
  }
}

export const supportService = new SupportService();
export default supportService;
