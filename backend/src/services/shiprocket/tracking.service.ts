import { ENDPOINTS } from './constants';
import { shiprocketRequest } from './utils';

export const shiprocketTrackingService = {
  /**
   * Track an AWB
   */
  async trackAwb(awb: string) {
    const response = await shiprocketRequest<any>(`${ENDPOINTS.TRACK_AWB}${awb}`);
    return response;
  }
};
