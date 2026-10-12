import { apiClient } from '../api/apiClient';
import { LoginCredentials, AuthResponse, AdminUser } from '../types';

class AuthService {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiClient.post('/auth/login', credentials);
    const data = response?.data !== undefined ? response.data : response;
    const { token, user } = data;
    
    if (user.role !== 'admin') {
      throw new Error('Access denied: Admins only.');
    }

    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_user', JSON.stringify(user));
    
    return data;
  }

  async logout(): Promise<void> {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
  }

  getCurrentUser(): AdminUser | null {
    const userStr = localStorage.getItem('admin_user');
    return userStr ? JSON.parse(userStr) : null;
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem('admin_token');
  }
}

export const authService = new AuthService();
export default authService;
