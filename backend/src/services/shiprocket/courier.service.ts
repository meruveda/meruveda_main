import { ENDPOINTS } from './constants';
import { shiprocketRequest } from './utils';

export const shiprocketCourierService = {
  /**
   * Check courier serviceability for a pincode
   */
  async checkServiceability(params: { pickup_postcode: string; delivery_postcode: string; weight: number; cod: 0 | 1 }) {
    const queryParams = new URLSearchParams({
      pickup_postcode: params.pickup_postcode,
      delivery_postcode: params.delivery_postcode,
      weight: params.weight.toString(),
      cod: params.cod.toString()
    });

    const response = await shiprocketRequest<any>(`${ENDPOINTS.CHECK_SERVICEABILITY}?${queryParams.toString()}`);
    return response;
  },

  /**
   * Generate AWB for a shipment
   */
  async generateAwb(shipmentId: string | number, courierId?: string | number) {
    const payload: any = {
      shipment_id: shipmentId,
    };
    if (courierId) {
      payload.courier_id = courierId;
    }

    const response = await shiprocketRequest<any>(ENDPOINTS.GENERATE_AWB, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return response;
  }
};
