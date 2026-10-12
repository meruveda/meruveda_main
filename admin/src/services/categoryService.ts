import { apiClient } from '../api/apiClient';
import { Category } from '../types';

class CategoryService {
  async getCategories(): Promise<Category[]> {
    return apiClient.get('/categories');
  }

  async getCategoryById(id: string): Promise<Category> {
    return apiClient.get(`/categories/${id}`);
  }

  async createCategory(data: Partial<Category>): Promise<Category> {
    return apiClient.post('/categories', data);
  }

  async updateCategory(id: string, data: Partial<Category>): Promise<Category> {
    return apiClient.patch(`/categories/${id}`, data);
  }

  async deleteCategory(id: string): Promise<void> {
    return apiClient.delete(`/categories/${id}`);
  }
}

export const categoryService = new CategoryService();
export default categoryService;
