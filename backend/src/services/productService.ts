import { supabase } from '../database/supabase';
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

export const productService = {
  async getProducts(params: any) {
    // Fail with an actionable message instead of a cryptic fetch failure
    // when the backend service is missing its Supabase env vars on Vercel
    // (local dev works because backend/.env exists there).
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error(
        'Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing). ' +
        'Set them on the backend service in Vercel and redeploy.'
      );
    }
    const { isFeatured, categoryId, search, status, stockStatus, page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc' } = params;

    let query = supabase.from('products').select('*, categories(id, name, slug)', { count: 'exact' });

    if (categoryId) query = query.eq('category_id', categoryId);
    if (status) query = query.eq('status', status);
    if (stockStatus) query = query.eq('stock_status', stockStatus);
    if (isFeatured !== undefined) {
      const isFeaturedVal = isFeatured === 'true' || isFeatured === true;
      query = query.eq('seo_metadata->>isFeatured', String(isFeaturedVal));
    }
    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,brand.ilike.%${search}%`);
    }

    if (params.isFeatured !== undefined) {
      const isFeaturedVal = params.isFeatured === 'true' || params.isFeatured === true;
      query = query.eq('seo_metadata->>isFeatured', String(isFeaturedVal));
    }
    if (params.isBestSeller !== undefined) {
      const isBestSellerVal = params.isBestSeller === 'true' || params.isBestSeller === true;
      query = query.eq('seo_metadata->>isBestSeller', String(isBestSellerVal));
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    query = query
      .order(sortBy as string, { ascending: sortOrder === 'asc' })
      .range(from, to);

    const { data, count, error } = await query;

    if (error) throw error;

    const camelData = toCamelCase(data) as any[];
    const mappedData = camelData.map(item => ({
      ...item,
      ...item.seoMetadata,
      longDescription: item.description,
      thumbnail: item.images?.[0]?.url || '',
      category: item.categories,
      categoryName: item.categories?.name || item.seoMetadata?.categoryName || 'No category'
    }));

    return {
      data: mappedData,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: count ? Math.ceil(count / limitNum) : 0
    };
  },

  async getProductById(id: string) {
    const { data, error } = await supabase
      .from('products')
      .select('*, categories(id, name, slug)')
      .eq('id', id)
      .single();

    if (error || !data) {
      const notFoundError = new Error('Product not found');
      (notFoundError as any).status = 404;
      throw notFoundError;
    }

    const camelItem = toCamelCase(data) as any;
    
    // Merge seoMetadata into the main object so fields like shortDescription are accessible
    if (camelItem.seoMetadata) {
      Object.assign(camelItem, camelItem.seoMetadata);
    }
    
    camelItem.longDescription = camelItem.description;
    camelItem.thumbnail = camelItem.images?.[0]?.url || '';
    camelItem.category = camelItem.categories;
    camelItem.categoryName = camelItem.categories?.name || camelItem.seoMetadata?.categoryName || 'No category';
    return camelItem;
  },

  async createProduct(payload: any) {
    const productData = buildProductData(payload);

    const { data, error } = await supabase
      .from('products')
      .insert(productData)
      .select()
      .single();

    if (error) throw error;

    const camelItem = toCamelCase(data) as any;
    if (camelItem.seoMetadata) {
      Object.assign(camelItem, camelItem.seoMetadata);
    }
    camelItem.longDescription = camelItem.description;
    camelItem.thumbnail = camelItem.images?.[0]?.url || '';
    return camelItem;
  },

  async updateProduct(id: string, payload: any) {
    const productData = buildProductData(payload);

    if (payload.stock === undefined && payload.minimumStock === undefined) {
      delete productData.stock_status; // Don't update stock_status if we didn't touch stock
    }

    // Handle image cleanup
    if (productData.images) {
      const existingProduct = await this.getProductById(id);
      const existingImageUrls = existingProduct.images?.map((img: any) => img.url) || [];
      const newImageUrls = productData.images.map((img: any) => img.url);
      
      const imagesToRemove = existingImageUrls.filter((url: string) => !newImageUrls.includes(url));
      
      if (imagesToRemove.length > 0) {
        storageService.deleteImagesByUrls(imagesToRemove).catch((err: any) => {
          console.error('Failed to cleanup old product images:', err);
        });
      }
    }

    const { data, error } = await supabase
      .from('products')
      .update(productData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    const camelItem = toCamelCase(data) as any;
    if (camelItem.seoMetadata) {
      Object.assign(camelItem, camelItem.seoMetadata);
    }
    camelItem.longDescription = camelItem.description;
    camelItem.thumbnail = camelItem.images?.[0]?.url || '';
    return camelItem;
  },

  async deleteProduct(id: string) {
    // Handle image cleanup
    try {
      const existingProduct = await this.getProductById(id);
      if (existingProduct.images && existingProduct.images.length > 0) {
        const imageUrls = existingProduct.images.map((img: any) => img.url);
        storageService.deleteImagesByUrls(imageUrls).catch((err: any) => {
          console.error('Failed to cleanup product images on delete:', err);
        });
      }
    } catch (e) {
      console.error('Error fetching product for image cleanup before delete:', e);
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
