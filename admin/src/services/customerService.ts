import { apiClient } from '../api/apiClient';
import axiosInstance from '../api/axiosInstance';
import { Customer, PaginationParams, PaginatedResponse } from '../types';

/** Maps a raw `users` row (+ computed metrics) onto the admin `Customer` shape. */
const customerDisplayName = (c: any): string => {
  const full = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  return c.displayName || full || c.name || c.email || (c.phone ? `Customer ${c.phone}` : 'Guest Customer');
};

const mapCustomer = (c: any): Customer => ({
  ...c,
  name: customerDisplayName(c),
  city: c.city || '',
  totalOrders: c.totalOrders || 0,
  lifetimeSpend: c.lifetimeSpend || 0,
  isActive: c.active !== false,
  isBlocked: c.active === false,
  createdAt: c.createdAt || c.created_at,
});

class CustomerService {
  async getCustomers(params?: PaginationParams & { search?: string }): Promise<Customer[]> {
    const response = await apiClient.get('/customers', { params });
    const rawData = Array.isArray(response) ? response : (response?.data || []);
    return rawData.map(mapCustomer);
  }

  /**
   * Paginated fetch that keeps the `total` / `totalPages` envelope which
   * `apiClient` (and therefore the old list view) used to throw away.
   */
  async getCustomersPage(
    params?: PaginationParams & { search?: string }
  ): Promise<{ items: Customer[]; total: number; totalPages: number }> {
    const response = await axiosInstance.get('/customers', {
      params: { page: 1, limit: 10, ...params },
    });
    const body = response.data || {};
    return {
      items: (body.data || []).map(mapCustomer),
      total: body.total || 0,
      totalPages: body.totalPages || 0,
    };
  }

  /**
   * Walks every page of the customer directory — used by the Excel download so
   * an export is never silently capped at the first page of results.
   */
  async getAllCustomers(search?: string): Promise<Customer[]> {
    const limit = 200;
    const all: Customer[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await axiosInstance.get('/customers', {
        params: { page, limit, ...(search ? { search } : {}) },
      });
      const body = response.data || {};
      const rows = body.data || [];
      all.push(...rows.map(mapCustomer));
      totalPages = body.totalPages || 1;
      page += 1;
      if (rows.length === 0) break;
    } while (page <= totalPages);

    return all;
  }

  async getCustomerById(id: string): Promise<Customer> {
    const c = await apiClient.get(`/customers/${id}`);
    // apiClient already unwraps response.data, so 'c' is the data object directly
    const customer = c?.data || c;
    return {
      ...customer,
      name: customerDisplayName(customer),
      city: customer.city || '',
      totalOrders: customer.totalOrders || 0,
      lifetimeSpend: customer.lifetimeSpend || 0,
      isActive: customer.active !== false,
      isBlocked: customer.active === false,
      createdAt: customer.createdAt || customer.created_at
    };
  }

  async updateCustomer(id: string, data: Partial<Customer>): Promise<Customer> {
    return apiClient.patch(`/customers/${id}`, data);
  }

  async deleteCustomer(id: string): Promise<void> {
    await apiClient.delete(`/customers/${id}`);
  }

  async toggleBlockCustomer(id: string): Promise<Customer> {
    const cust = await this.getCustomerById(id);
    const response = await this.updateCustomerStatus(id, cust.isBlocked);
    const data = (response as any).data?.data || (response as any).data || response;
    return {
      ...data,
      name: customerDisplayName(data),
      city: (data as any).city || '',
      totalOrders: data.totalOrders || 0,
      lifetimeSpend: data.lifetimeSpend || 0,
      isBlocked: data.active === false
    };
  }

  async getCustomerAddresses(id: string): Promise<any[]> {
    const response = await apiClient.get(`/customers/${id}/addresses`);
    // apiClient unwraps response.data; the addresses may be nested further
    return Array.isArray(response) ? response : (response?.data || []);
  }

  async getCustomerPreferences(id: string): Promise<any> {
    const res = await apiClient.get(`/auth/preferences/${id}`);
    return res?.data || res;
  }

  async getCustomerCart(id: string): Promise<any[]> {
    const response = await apiClient.get(`/customers/${id}/cart`);
    return Array.isArray(response) ? response : (response?.data || []);
  }

  async updateCustomerStatus(id: string, active: boolean): Promise<Customer> {
    return apiClient.patch(`/customers/${id}/status`, { active });
  }
}

export const customerService = new CustomerService();
export default customerService;
