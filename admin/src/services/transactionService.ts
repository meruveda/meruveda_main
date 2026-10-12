import { apiClient } from '../api/apiClient';
import axiosInstance from '../api/axiosInstance';
import { Transaction, PaginationParams, PaginatedResponse } from '../types';

const mapTransaction = (t: any): Transaction => {
      let method: any = 'unknown';
      const isCOD = t.payment_method === 'Cash On Delivery' || String(t.payment_method).toUpperCase() === 'COD';
      if (isCOD) {
        method = 'cod';
      } else if (t.metadata?.gateway_mode === 'UPI') {
        method = 'upi';
      } else if (t.metadata?.gateway_mode === 'NB') {
        method = 'netbanking';
      } else if (t.metadata?.gateway_mode === 'WL') {
        method = 'wallet';
      } else if (t.metadata?.gateway_mode === 'CC' || t.metadata?.gateway_mode === 'DC') {
        method = 'card';
      }

      return {
        id: t.id,
        orderId: t.order_id,
        orderNumber: t.orders?.order_number || 'N/A',
        customerId: t.user_id || 'guest',
        customerName: t.users ? `${t.users.first_name || ''} ${t.users.last_name || ''}`.trim() : 'Guest',
        type: t.type || 'payment',
        method,
        amount: Number(t.amount || 0),
        status: t.status,
        gatewayRef: t.gateway_transaction_id,
        createdAt: t.created_at
      };
};

class TransactionService {
  async getTransactions(params?: PaginationParams & { status?: string, type?: string } | any): Promise<Transaction[]> {
    const response = await apiClient.get('/transactions', { params });
    const rawTxns = Array.isArray(response) ? response : (response?.data || []);
    return rawTxns.map(mapTransaction);
  }

  /** Page-walk for exports (backend may paginate the log). */
  async getAllTransactions(params?: Record<string, any>): Promise<Transaction[]> {
    const limit = 200;
    const all: Transaction[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await axiosInstance.get('/transactions', {
        params: { page, limit, ...params },
      });
      const body = response.data || {};
      const rows = Array.isArray(body) ? body : body.data || [];
      all.push(...rows.map(mapTransaction));
      totalPages = body.totalPages || 1;
      if (rows.length === 0) break;
      // If the backend doesn't paginate, a single fetch is everything.
      if (!body.totalPages && !body.total) break;
      page += 1;
    } while (page <= totalPages);

    return all;
  }

  async updateTransactionStatus(id: string, status: string, gateway_transaction_id?: string): Promise<Transaction> {
    return apiClient.patch(`/transactions/${id}/status`, { status, gateway_transaction_id });
  }
}

export const transactionService = new TransactionService();
export default transactionService;
