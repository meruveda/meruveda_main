import { isDbConfigured } from '../database/db';
import * as productsRepo from '../database/repos/products';
import { config } from '../config/env';
import { slugify, toCamelCase } from '@meruveda/shared';
import { storageService } from './storageService';

const buildProductData = (rawData: any) => {
  const stock = rawData.stock !== undefined ? Number(rawData.stock) : 0;
  const minStock = rawData.minimumStock !== undefined ? Number(rawData.minimumStock) : 10;
  const stockStatus = stock === 0 ? 'out_of_stock' : stock <= minStock ? 'low_stock' : 'in_stock';

  const productData: any = {
    stock_status: stockStatus
  };

  if (rawData.name !== undefined) {
    productData.name = rawData.name;
    productData.slug = slugify(rawData.name);
  }
  if (rawData.sku !== undefined) productData.sku = rawData.sku;
  if (rawData.categoryId !== undefined) productData.category_id = rawData.categoryId;
  if (rawData.longDescription !== undefined || rawData.shortDescription !== undefined || rawData.description !== undefined) {
    productData.description = rawData.longDescription || rawData.description || rawData.shortDescription;
  }
  if (rawData.mrp !== undefined || rawData.price !== undefined) productData.price = rawData.mrp || rawData.price;
  if (rawData.sellingPrice !== undefined) productData.selling_price = rawData.sellingPrice;
  if (rawData.stock !== undefined) productData.stock = stock;
  if (rawData.minimumStock !== undefined) productData.minimum_stock = minStock;
  if (rawData.brand !== undefined) productData.brand = rawData.brand;
  if (rawData.status !== undefined) productData.status = rawData.status;
  if (rawData.images !== undefined) productData.images = rawData.images;
  if (rawData.weight !== undefined) productData.weight = Number(rawData.weight) || 0.5;
  if (rawData.length !== undefined) productData.length = Number(rawData.length) || 10;
  if (rawData.breadth !== undefined) productData.breadth = Number(rawData.breadth) || 10;
  if (rawData.height !== undefined) productData.height = Number(rawData.height) || 10;
  if (rawData.hsn !== undefined) productData.hsn = rawData.hsn;
  if (rawData.hsnCode !== undefined) productData.hsn = rawData.hsnCode;
  if (rawData.hsn_code !== undefined) productData.hsn = rawData.hsn_code;

  // Extra fields stored in seo_metadata
  const extraFields = ['seoTitle', 'seoDescription', 'isFeatured', 'isTrending', 'isBestSeller', 'isRecommended', 'benefits', 'dosage', 'ingredients', 'warnings', 'expiryDate', 'manufacturer', 'country', 'gst', 'gst_rate', 'gstRate', 'hsn_code', 'hsnCode', 'shortDescription', 'categoryName'];

  const seo_metadata: any = {};
  let hasMetadata = false;
  for (const field of extraFields) {
    if (rawData[field] !== undefined) {
      seo_metadata[field] = rawData[field];
      hasMetadata = true;
    }
  }

  if (hasMetadata) {
    productData.seo_metadata = seo_metadata;
  }

  return productData;
};

function mapProduct(raw: any, isAdmin: boolean) {
  const camelItem = toCamelCase(raw) as any;

  if (camelItem.seoMetadata) {
    Object.assign(camelItem, camelItem.seoMetadata);
  }

  camelItem.longDescription = camelItem.description;
  camelItem.thumbnail = camelItem.images?.[0]?.url || '';
  camelItem.category = camelItem.categories;
  camelItem.categoryName = camelItem.categories?.name || camelItem.seoMetadata?.categoryName || 'No category';

  if (!isAdmin) {
    // Internal inventory figures are an admin concern only.
    delete camelItem.minimumStock;
    delete camelItem.minimum_stock;
  }

  return camelItem;
}

export const productService = {
  async getProducts(params: any, opts: { isAdmin?: boolean } = {}) {
    if (!isDbConfigured()) {
      throw new Error(
        'Database is not configured (DATABASE_URL missing). ' +
        'Set it on the backend service in Vercel and redeploy.'
      );
    }

    const {
      isFeatured, categoryId, search, status, stockStatus,
      page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc',
      isBestSeller,
    } = params;

    const isAdmin = opts.isAdmin === true;
    const pageNum = Number(page) || 1;
    const requestedLimit = Number(limit) || 10;
    // Public/customer lists are capped; admin pagination is not.
    const limitNum = isAdmin ? requestedLimit : Math.min(requestedLimit, 100);

    const toBool = (v: any) => v === 'true' || v === true;

    const { rows, count } = await productsRepo.listProducts({
      categoryId,
      status,
      stockStatus,
      isFeatured: isFeatured !== undefined ? toBool(isFeatured) : undefined,
      isBestSeller: isBestSeller !== undefined ? toBool(isBestSeller) : undefined,
      search,
      sortBy: String(sortBy),
      sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
      isAdmin,
    });

    return {
      data: rows.map((row) => mapProduct(row, isAdmin)),
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: count ? Math.ceil(count / limitNum) : 0,
    };
  },

  async getProductById(id: string, opts: { isAdmin?: boolean } = {}) {
    const row = await productsRepo.getProductById(id);

    if (!row) {
      const notFoundError = new Error('Product not found');
      (notFoundError as any).status = 404;
      throw notFoundError;
    }

    return mapProduct(row, opts.isAdmin === true);
  },

  async createProduct(payload: any) {
    const productData = buildProductData(payload);
    const data = await productsRepo.insertProduct(productData);
    return mapProduct(data, true);
  },

  async updateProduct(id: string, payload: any) {
    const productData = buildProductData(payload);

    if (payload.stock === undefined && payload.minimumStock === undefined) {
      delete productData.stock_status; // Don't update stock_status if we didn't touch stock
    }

    // Handle image cleanup
    if (productData.images) {
      const existingProduct = await this.getProductById(id, { isAdmin: true });
      const existingImageUrls = existingProduct.images?.map((img: any) => img.url) || [];
      const newImageUrls = productData.images.map((img: any) => img.url);

      const imagesToRemove = existingImageUrls.filter((url: string) => !newImageUrls.includes(url));

      if (imagesToRemove.length > 0) {
        storageService.deleteImagesByUrls(imagesToRemove).catch((err: any) => {
          console.error('Failed to cleanup old product images:', err);
        });
      }
    }

    const data = await productsRepo.updateProduct(id, productData);
    if (!data) {
      const err = new Error('Product not found');
      (err as any).status = 404;
      throw err;
    }
    return mapProduct(data, true);
  },

  async deleteProduct(id: string) {
    // Handle image cleanup
    try {
      const existingProduct = await this.getProductById(id, { isAdmin: true });
      if (existingProduct.images && existingProduct.images.length > 0) {
        const imageUrls = existingProduct.images.map((img: any) => img.url);
        storageService.deleteImagesByUrls(imageUrls).catch((err: any) => {
          console.error('Failed to cleanup product images on delete:', err);
        });
      }
    } catch (e) {
      console.error('Error fetching product for image cleanup before delete:', e);
    }

    await productsRepo.deleteProduct(id);
  }
};
