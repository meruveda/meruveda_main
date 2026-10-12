import { ENDPOINTS } from './constants';
import { shiprocketRequest } from './utils';

export const shiprocketPickupService = {
  /**
   * Schedule a pickup for an array of shipment IDs
   */
  async schedulePickup(shipmentId: string | number | (string | number)[]) {
    const shipment_id = Array.isArray(shipmentId) ? shipmentId : [shipmentId];
    
    const response = await shiprocketRequest<any>(ENDPOINTS.SCHEDULE_PICKUP, {
      method: 'POST',
      body: JSON.stringify({ shipment_id }),
    });

    return response;
  }
};
