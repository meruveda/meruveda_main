import { apiClient } from '../api/apiClient';
import { Admin } from '../types/auth';

class AdminService {
  async getAdmins(): Promise<Admin[]> {
    const response = await apiClient.get('/customers', { params: { role: 'all' } }); 
    const data = response?.data !== undefined ? response.data : response;
    const rawList = Array.isArray(data) ? data : (data?.data || []);
    return rawList.map((usr: any) => ({
      ...usr,
      name: usr.name || `${usr.first_name || ''} ${usr.last_name || ''}`.trim() || usr.email || 'Unknown',
      isActive: usr.isActive !== undefined ? Boolean(usr.isActive) : (usr.active !== undefined ? Boolean(usr.active) : true),
      createdAt: usr.createdAt || usr.created_at
    }));
  }

  async createAdmin(data: Partial<Admin>): Promise<Admin> {
    return apiClient.post('/auth/register', data);
  }

  async updateAdmin(id: string, data: Partial<Admin>): Promise<Admin> {
    return apiClient.patch(`/customers/${id}`, data);
  }

  async deleteAdmin(id: string): Promise<void> {
    await apiClient.delete(`/customers/${id}`);
  }

  async resetPassword(id: string): Promise<void> {
    await apiClient.post(`/customers/${id}/reset-password`);
  }

  async toggleAdminStatus(id: string, active: boolean): Promise<Admin> {
    return apiClient.patch(`/customers/${id}/status`, { active });
  }
}

export const adminService = new AdminService();
export default adminService;
