import { Request, Response, NextFunction } from 'express';
import { categoryService } from '../services/categoryService';

export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await categoryService.getCategories();
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await categoryService.createCategory(req.body);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await categoryService.updateCategory(id as string, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await categoryService.deleteCategory(id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
