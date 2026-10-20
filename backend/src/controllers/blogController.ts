import { Request, Response, NextFunction } from 'express';
import * as blogsRepo from '../database/repos/blogs';
import { slugify } from '@meruveda/shared';
import { storageService } from '../services/storageService';
import { hasColumn } from '../services/schemaGuard';

const buildBlogData = async (rawData: any) => {
  const blogData: any = {};
  
  if (rawData.title !== undefined) blogData.title = rawData.title;
  if (rawData.slug !== undefined) blogData.slug = rawData.slug;
  if (rawData.excerpt !== undefined) blogData.excerpt = rawData.excerpt;
  if (rawData.content !== undefined) blogData.content = rawData.content;
  if (rawData.authorId !== undefined) blogData.author_id = rawData.authorId;
  if (rawData.status !== undefined) blogData.status = rawData.status;
  if (rawData.publishedAt !== undefined) blogData.published_at = rawData.publishedAt;

  // `blogs.featured_image` / `blogs.seo_metadata` are pending DB columns. Skipping
  // them (instead of sending them) keeps the rest of the blog saveable on an
  // un-migrated schema; admin UI shows the missing-image/SEO state.
  if (rawData.featuredImage !== undefined && (await hasColumn('blogs', 'featured_image'))) {
    blogData.featured_image = rawData.featuredImage;
  }

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
  
  if (hasMetadata && (await hasColumn('blogs', 'seo_metadata'))) {
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
    // A public caller only ever sees published posts. An admin can ask for
    // the drafts and archived ones explicitly.
    const isAdmin = req.user?.role === 'admin';
    const rows = await blogsRepo.listBlogs(status as string | undefined, {
      includeUnpublished: isAdmin,
    });
    res.json({ data: rows.rows.map(mapBlogResponse), total: rows.count });
  } catch (error) {
    next(error);
  }
};

export const getBlogBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const slugStr = typeof slug === 'string' ? slug : (Array.isArray(slug) ? slug[0] : '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slugStr);

    const data = await blogsRepo.findBlog(slugStr, isUuid);
    if (!data) return res.status(404).json({ error: { message: 'Blog not found' } });
    // A draft or an archived post is invisible to the public; an admin can
    // still open it from the panel.
    const isPublished = String(data.status || '').toLowerCase() === 'published';
    if (!isPublished && req.user?.role !== 'admin') {
      return res.status(404).json({ error: { message: 'Blog not found' } });
    }
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

    const blogData = await buildBlogData(rawBody);

    const data = await blogsRepo.insertBlog(blogData);
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
        const existingBlog = await blogsRepo.getFeaturedImage(id as string);
        if (existingBlog && existingBlog.featured_image && existingBlog.featured_image !== updates.featuredImage) {
          storageService.deleteImagesByUrls([existingBlog.featured_image as string]).catch((err: any) => {
            console.error('Failed to cleanup old blog image:', err);
          });
        }
      } catch (e) {
        console.error('Error fetching blog for image cleanup:', e);
      }
    }

    const blogData = await buildBlogData(updates);

    const data = await blogsRepo.updateBlog(id as string, blogData);
    if (!data) throw new Error('Blog not found');
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
      const existingBlog = await blogsRepo.getFeaturedImage(id as string);
      if (existingBlog && existingBlog.featured_image) {
        storageService.deleteImagesByUrls([existingBlog.featured_image as string]).catch((err: any) => {
          console.error('Failed to cleanup blog image on delete:', err);
        });
      }
    } catch (e) {
      console.error('Error fetching blog for image cleanup before delete:', e);
    }

    await blogsRepo.deleteBlog(id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
