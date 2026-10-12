import { apiClient } from '../api/apiClient';
import { BlogPost, PaginationParams, PaginatedResponse } from '../types';

class BlogService {
  async getPosts(params?: PaginationParams & { status?: string }): Promise<PaginatedResponse<BlogPost>> {
    return apiClient.get('/blogs', { params });
  }

  async getPostById(id: string): Promise<BlogPost> {
    const response = await apiClient.get(`/blogs/${id}`); // Assumes backend supports ID if slug doesn't match ID
    return response.data.data;
  }

  async createPost(data: Partial<BlogPost>): Promise<BlogPost> {
    return apiClient.post('/blogs', data);
  }

  async updatePost(id: string, data: Partial<BlogPost>): Promise<BlogPost> {
    return apiClient.patch(`/blogs/${id}`, data);
  }

  async deletePost(id: string): Promise<void> {
    await apiClient.delete(`/blogs/${id}`);
  }

  async getBlogs(params?: PaginationParams & { status?: string }): Promise<BlogPost[]> {
    const response = await apiClient.get('/blogs', { params });
    return Array.isArray(response) ? response : (response?.data || []);
  }

  async getBlogById(id: string): Promise<BlogPost> {
    return apiClient.get(`/blogs/${id}`);
  }

  async createBlog(data: Partial<BlogPost>, authorName?: string): Promise<BlogPost> {
    const payload = { ...data, authorName };
    return apiClient.post('/blogs', payload);
  }

  async updateBlog(id: string, data: Partial<BlogPost>): Promise<BlogPost> {
    return apiClient.patch(`/blogs/${id}`, data);
  }

  async deleteBlog(id: string): Promise<void> {
    await apiClient.delete(`/blogs/${id}`);
  }
}

export const blogService = new BlogService();
export default blogService;
