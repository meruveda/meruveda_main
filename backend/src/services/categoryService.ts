import { supabase } from '../database/supabase';
import { slugify } from '@meruveda/shared';
import { storageService } from './storageService';

export const categoryService = {
  async getCategories() {
    const { data, error } = await supabase
      .from('categories')
      .select('*, products(id)')
      .order('name', { ascending: true });

    if (error) throw error;
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
    const { data, error } = await supabase
      .from('categories')
      .insert({ ...payload, slug })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateCategory(id: string, updates: any) {
    if (updates.name) {
      updates.slug = slugify(updates.name);
    }
    // Handle image and banner cleanup
    if (updates.image !== undefined || updates.banner !== undefined) {
      try {
        const { data: existingCategory } = await supabase.from('categories').select('image, banner').eq('id', id).single();
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
      } catch (e) {
        console.error('Error fetching category for image cleanup:', e);
      }
    }

    const { data, error } = await supabase
      .from('categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteCategory(id: string) {
    try {
      const { data: existingCategory } = await supabase.from('categories').select('image, banner').eq('id', id).single();
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
    } catch (e) {
      console.error('Error fetching category for image cleanup before delete:', e);
    }

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
