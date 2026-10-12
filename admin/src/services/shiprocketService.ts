import { apiClient } from '../api/apiClient';
import axiosInstance from '../api/axiosInstance';

class ShiprocketService {
  async generateAwb(shipmentId: string | number) {
    return apiClient.post('/shiprocket/generate-awb', { shipmentId });
  }

  async schedulePickup(shipmentId: string | number) {
    return apiClient.post('/shiprocket/schedule-pickup', { shipmentId });
  }

  async trackShipment(awb: string) {
    return apiClient.get(`/shiprocket/tracking/${awb}`);
  }

  async getLabel(shipmentId: string | number) {
    return apiClient.get(`/shiprocket/label/${shipmentId}`);
  }

  async getInvoice(shipmentId: string | number) {
    return apiClient.get(`/shiprocket/invoice/${shipmentId}`);
  }

  async cancelOrder(orderId: string) {
    return apiClient.post('/shiprocket/cancel-order', { orderId });
  }

  async pushOrderToShiprocket(orderId: string) {
    const res = await axiosInstance.post(`/orders/${orderId}/push-shiprocket`);
    return res.data;
  }

  async retryFailedPushes(limit = 20) {
    const res = await axiosInstance.post('/orders/retry-shiprocket-failed', null, { params: { limit } });
    return res.data;
  }
}

export const shiprocketService = new ShiprocketService();
export default shiprocketService;
