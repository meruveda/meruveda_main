import { apiClient } from '../api/apiClient';
import { MediaItem } from '../types';

class MediaService {
  async getMedia(folder?: string): Promise<MediaItem[]> {
    return apiClient.get('/media', { params: { folder } });
  }

  async uploadMedia(file: File, folder: string = '/'): Promise<MediaItem> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);

    return apiClient.post('/media/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
  }

  async deleteMedia(id: string): Promise<void> {
    await apiClient.delete(`/media/${id}`);
  }

  async getFiles(folder?: string, type?: string): Promise<any[]> {
    return apiClient.get('/media', { params: { folder, type } });
  }

  async uploadFile(file: File, folder?: string): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    if (folder) formData.append('folder', folder);
    return apiClient.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }

  async deleteFile(id: string): Promise<void> {
    await this.deleteMedia(id);
  }
}

export const mediaService = new MediaService();
export default mediaService;
