import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';
import { slugify } from '@meruveda/shared';
import { storageService } from '../services/storageService';

const buildBlogData = (rawData: any) => {
  const blogData: any = {};
  
  if (rawData.title !== undefined) blogData.title = rawData.title;
  if (rawData.slug !== undefined) blogData.slug = rawData.slug;
  if (rawData.excerpt !== undefined) blogData.excerpt = rawData.excerpt;
  if (rawData.content !== undefined) blogData.content = rawData.content;
  if (rawData.authorId !== undefined) blogData.author_id = rawData.authorId;
  if (rawData.featuredImage !== undefined) blogData.featured_image = rawData.featuredImage;
  if (rawData.status !== undefined) blogData.status = rawData.status;
  if (rawData.publishedAt !== undefined) blogData.published_at = rawData.publishedAt;
  
  // Extra fields stored in seo_metadata
  const extraFields = ['seoTitle', 'seoDescription', 'tags', 'scheduledAt'];
  const seo_metadata: any = {};
  let hasMetadata = false;
  
  for (const field of extraFields) {
    if (rawData[field] !== undefined) {
      seo_metadata[field] = rawData[field];
      hasMetadata = true;
    }
  }
  
  if (hasMetadata) {
    blogData.seo_metadata = seo_metadata;
  }
  
  return blogData;
};

const mapBlogResponse = (item: any) => {
  if (!item) return item;
  const seo = item.seo_metadata || {};
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    excerpt: item.excerpt || '',
    content: item.content,
    authorId: item.author_id,
    featuredImage: item.featured_image || '',
    status: item.status,
    publishedAt: item.published_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    authorName: item.users ? `${item.users.first_name || ''} ${item.users.last_name || ''}`.trim() : 'Veda Admin',
    seoTitle: seo.seoTitle || '',
    seoDescription: seo.seoDescription || '',
    tags: seo.tags || [],
    scheduledAt: seo.scheduledAt || '',
  };
};

export const getBlogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    let query = supabase.from('blogs').select('*, users(first_name, last_name)', { count: 'exact' }).order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, count, error } = await query;
    if (error) throw error;
    res.json({ data: data.map(mapBlogResponse), total: count });
  } catch (error) {
    next(error);
  }
};

export const getBlogBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const slugStr = typeof slug === 'string' ? slug : (Array.isArray(slug) ? slug[0] : '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slugStr);

    let query = supabase.from('blogs').select('*, users(first_name, last_name)');
    if (isUuid) {
      query = query.or(`id.eq.${slugStr},slug.eq.${slugStr}`);
    } else {
      query = query.eq('slug', slugStr);
    }

    const { data, error } = await query.single();
    if (error || !data) return res.status(404).json({ error: { message: 'Blog not found' } });
    res.json({ data: mapBlogResponse(data) });
  } catch (error) {
    next(error);
  }
};

export const createBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawBody = req.body;
    rawBody.slug = rawBody.slug || slugify(rawBody.title);
    rawBody.authorId = req.user?.id;
    
    if (rawBody.status === 'published' && !rawBody.publishedAt) {
      rawBody.publishedAt = new Date().toISOString();
    }

    const blogData = buildBlogData(rawBody);

    const { data, error } = await supabase.from('blogs').insert(blogData).select().single();
    if (error) throw error;
    res.status(201).json({ data: mapBlogResponse(data) });
  } catch (error) {
    next(error);
  }
};

export const updateBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    if (updates.title && !updates.slug) updates.slug = slugify(updates.title);
    if (updates.status === 'published' && !updates.publishedAt) {
      updates.publishedAt = new Date().toISOString();
    }

    // Handle image cleanup
    if (updates.featuredImage !== undefined) {
      try {
        const { data: existingBlog } = await supabase.from('blogs').select('featured_image').eq('id', id).single();
        if (existingBlog && existingBlog.featured_image && existingBlog.featured_image !== updates.featuredImage) {
          storageService.deleteImagesByUrls([existingBlog.featured_image as string]).catch((err: any) => {
            console.error('Failed to cleanup old blog image:', err);
          });
        }
      } catch (e) {
        console.error('Error fetching blog for image cleanup:', e);
      }
    }

    const blogData = buildBlogData(updates);

    const { data, error } = await supabase.from('blogs').update(blogData).eq('id', id).select().single();
    if (error) throw error;
    res.json({ data: mapBlogResponse(data) });
  } catch (error) {
    next(error);
  }
};

export const deleteBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Handle image cleanup
    try {
      const { data: existingBlog } = await supabase.from('blogs').select('featured_image').eq('id', id).single();
      if (existingBlog && existingBlog.featured_image) {
        storageService.deleteImagesByUrls([existingBlog.featured_image as string]).catch((err: any) => {
          console.error('Failed to cleanup blog image on delete:', err);
        });
      }
    } catch (e) {
      console.error('Error fetching blog for image cleanup before delete:', e);
    }

    const { error } = await supabase.from('blogs').delete().eq('id', id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
