import { apiClient } from '../api/apiClient';
import { InventoryItem, StockMovement } from '../types';

class InventoryService {
  async getInventory(): Promise<InventoryItem[]> {
    const response = await apiClient.get('/products');
    const rawData = Array.isArray(response) ? response : (response?.data || []);
    return rawData.map((p: any) => ({
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      currentStock: p.stock,
      minimumStock: p.minimum_stock,
      stockStatus: p.stock_status,
      lastRestocked: p.updated_at
    }));
  }

  async adjustStock(
    productId: string,
    quantity: number,
    type: 'addition' | 'reduction' | 'adjustment',
    reason: string,
    adminName: string
  ): Promise<InventoryItem> {
    // In a real scenario, this would hit a dedicated /inventory endpoint to log the movement
    // For now, we update the product stock directly
    let newStock = quantity;
    if (type !== 'adjustment') {
       const product = await apiClient.get(`/products/${productId}`);
       const prodData = product?.stock !== undefined ? product : (product?.data?.data || product?.data || product);
       newStock = type === 'addition' ? prodData.stock + quantity : Math.max(0, prodData.stock - quantity);
    }
    return apiClient.patch(`/products/${productId}`, { stock: newStock });
  }

  async getStockMovements(): Promise<StockMovement[]> {
    // Placeholder as backend doesn't have a stock_movements table yet
    return [];
  }
}

export const inventoryService = new InventoryService();
export default inventoryService;
