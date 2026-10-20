import * as categoriesRepo from '../database/repos/categories';
import { slugify } from '@meruveda/shared';
import { storageService } from './storageService';
import { hasColumn } from './schemaGuard';

// `categories.image` / `categories.banner` are pending DB columns. On an un-migrated
// schema they are dropped from the payload so the category itself stays saveable.
const stripMissingImageColumns = async (payload: any) => {
  if (payload?.image !== undefined && !(await hasColumn('categories', 'image'))) delete payload.image;
  if (payload?.banner !== undefined && !(await hasColumn('categories', 'banner'))) delete payload.banner;
  return payload;
};

export const categoryService = {
  async getCategories() {
    const data = await categoriesRepo.listCategories();
    return data.map((cat: any) => {
      const productCount = cat.products ? cat.products.length : 0;
      const { products, ...rest } = cat;
      return {
        ...rest,
        productCount
      };
    });
  },

  async createCategory(payload: { name: string; description?: string; parent_id?: string }) {
    const slug = slugify(payload.name);
    const clean = await stripMissingImageColumns({ ...payload });
    return categoriesRepo.insertCategory({ ...clean, slug });
  },

  async updateCategory(id: string, updates: any) {
    if (updates.name) {
      updates.slug = slugify(updates.name);
    }
    // Handle image and banner cleanup
    if (updates.image !== undefined || updates.banner !== undefined) {
      try {
        const columns = ['image', 'banner'].filter((c) => c === 'image' ? updates.image !== undefined : updates.banner !== undefined);
        const selectCols: string[] = [];
        if (columns.includes('image') && (await hasColumn('categories', 'image'))) selectCols.push('image');
        if (columns.includes('banner') && (await hasColumn('categories', 'banner'))) selectCols.push('banner');

        if (selectCols.length > 0) {
          const existingCategory = await categoriesRepo.getCategoryColumns(id, selectCols);
          if (existingCategory) {
            const urlsToDelete: string[] = [];
            if (updates.image !== undefined && existingCategory.image && existingCategory.image !== updates.image) {
              urlsToDelete.push(existingCategory.image);
            }
            if (updates.banner !== undefined && existingCategory.banner && existingCategory.banner !== updates.banner) {
              urlsToDelete.push(existingCategory.banner);
            }

            if (urlsToDelete.length > 0) {
              storageService.deleteImagesByUrls(urlsToDelete).catch((err: any) => {
                console.error('Failed to cleanup old category images:', err);
              });
            }
          }
        }
      } catch (e) {
        console.error('Error fetching category for image cleanup:', e);
      }
    }

    await stripMissingImageColumns(updates);

    const data = await categoriesRepo.updateCategory(id, updates);
    if (!data) {
      const err = new Error('Category not found');
      (err as any).status = 404;
      throw err;
    }
    return data;
  },

  async deleteCategory(id: string) {
    try {
      const selectCols = [
        (await hasColumn('categories', 'image')) ? 'image' : null,
        (await hasColumn('categories', 'banner')) ? 'banner' : null
      ]
        .filter(Boolean) as string[];

      if (selectCols.length > 0) {
        const existingCategory = await categoriesRepo.getCategoryColumns(id, selectCols);

        if (existingCategory) {
          const urlsToDelete: string[] = [];
          if (existingCategory.image) urlsToDelete.push(existingCategory.image);
          if (existingCategory.banner) urlsToDelete.push(existingCategory.banner);
          if (urlsToDelete.length > 0) {
            storageService.deleteImagesByUrls(urlsToDelete).catch((err: any) => {
              console.error('Failed to cleanup category images on delete:', err);
            });
          }
        }
      }
    } catch (e) {
      console.error('Error fetching category for image cleanup before delete:', e);
    }

    await categoriesRepo.deleteCategory(id);
  }
};
