import { Request, Response, NextFunction } from 'express';
import * as notificationsRepo from '../database/repos/notifications';

export const getNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await notificationsRepo.listForUser(req.user?.id as string);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await notificationsRepo.markRead(req.user?.id as string, id as string);
    if (!data) throw new Error('Notification not found');
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await notificationsRepo.markAllRead(req.user?.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const deleteNotification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await notificationsRepo.remove(req.user?.id as string, id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
