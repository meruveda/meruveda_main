import { Request, Response, NextFunction } from 'express';
import { productService } from '../services/productService';

export const getProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await productService.getProducts(req.query);
    res.json(result);
  } catch (error: any) {
    // Vercel logs are the only way to see the real cause of a 500 in prod —
    // include query + underlying Supabase message here.
    console.error('[Products] getProducts failed:', {
      query: req.query,
      message: error?.message || error,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    });
    next(error);
  }
};

export const getProductById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await productService.getProductById(id as string);
    res.json({ data });
  } catch (error: any) {
    if (error.status === 404) {
      return res.status(404).json({ error: { message: error.message } });
    }
    next(error);
  }
};

export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await productService.createProduct(req.body);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await productService.updateProduct(id as string, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await productService.deleteProduct(id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
