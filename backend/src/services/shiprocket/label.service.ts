import { ENDPOINTS } from './constants';
import { shiprocketRequest } from './utils';

export const shiprocketLabelService = {
  /**
   * Generate label for shipment(s)
   */
  async generateLabel(shipmentId: string | number | (string | number)[]) {
    const shipment_id = Array.isArray(shipmentId) ? shipmentId : [shipmentId];
    
    const response = await shiprocketRequest<any>(ENDPOINTS.GENERATE_LABEL, {
      method: 'POST',
      body: JSON.stringify({ shipment_id }),
    });

    return response;
  },

  /**
   * Generate invoice for order(s)
   */
  async generateInvoice(orderIds: string | number | (string | number)[]) {
    const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
    
    const response = await shiprocketRequest<any>(ENDPOINTS.GENERATE_INVOICE, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    return response;
  },

  /**
   * Generate manifest
   */
  async generateManifest(shipmentId: string | number | (string | number)[]) {
    const shipment_id = Array.isArray(shipmentId) ? shipmentId : [shipmentId];
    
    const response = await shiprocketRequest<any>(ENDPOINTS.GENERATE_MANIFEST, {
      method: 'POST',
      body: JSON.stringify({ shipment_id }),
    });

    return response;
  }
};
