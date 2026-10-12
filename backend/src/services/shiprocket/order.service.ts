import { ENDPOINTS } from './constants';
import { shiprocketRequest } from './utils';
import { ShiprocketOrderPayload } from './types';

export const shiprocketOrderService = {
  /**
   * Create an adhoc order in Shiprocket
   */
  async createOrder(payload: ShiprocketOrderPayload) {
    // Inject pickup location and channel_id from environment if not explicitly set
    const data = {
      ...payload,
      pickup_location: payload.pickup_location || process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
      channel_id: payload.channel_id || process.env.SHIPROCKET_CHANNEL_ID || '',
    };

    const response = await shiprocketRequest<any>(ENDPOINTS.CREATE_ORDER, {
      method: 'POST',
      body: JSON.stringify(data),
    });

    return response;
  },

  /**
   * Cancel an order in Shiprocket
   */
  async cancelOrder(awbs: string[]) {
    const response = await shiprocketRequest<any>(ENDPOINTS.CANCEL_ORDER, {
      method: 'POST',
      body: JSON.stringify({ awbs }),
    });

    return response;
  },

  /**
   * Cancel an order in Shiprocket by order IDs
   */
  async cancelOrderByIds(ids: (string | number)[]) {
    const response = await shiprocketRequest<any>(ENDPOINTS.CANCEL_ORDER_BY_ID, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    return response;
  }
};
