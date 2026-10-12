import { apiClient } from '../api/apiClient';
import { StoreSettings } from '../types';

class SettingsService {
  async getSettings(): Promise<StoreSettings> {
    return apiClient.get('/settings');
  }

  async updateSettings(settings: Partial<StoreSettings>): Promise<void> {
    await apiClient.post('/settings', settings);
  }
}

export const settingsService = new SettingsService();
export default settingsService;
