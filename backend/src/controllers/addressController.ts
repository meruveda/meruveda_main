import { Request, Response, NextFunction } from 'express';
import { addressService, AddressBookUnavailable } from '../services/addressService';

/**
 * Address book endpoints.
 *
 * Every handler reads `req.user.id` and never a user id from the request body,
 * so a customer cannot read or modify another customer's addresses by crafting a
 * request.
 */

const userId = (req: Request): string => (req as any).user?.id;
/** Express 5 types a route param as string | string[]; we only ever expect one. */
const param = (req: Request, name: string): string => String((req.params as any)[name]);

export const listAddresses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ addresses: await addressService.list(userId(req)) });
  } catch (e) {
    next(e);
  }
};

export const createAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, created } = await addressService.create(userId(req), req.body);
    res.status(created ? 201 : 200).json({ address, created });
  } catch (e) {
    next(e);
  }
};

export const updateAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await addressService.update(userId(req), param(req, "id"), req.body);
    if (!address) return res.status(404).json({ error: { message: 'Address not found.' } });
    res.json({ address });
  } catch (e) {
    next(e);
  }
};

export const deleteAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await addressService.remove(userId(req), param(req, "id"));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};

export const setDefaultAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await addressService.setDefault(userId(req), param(req, "id"));
    if (!address) return res.status(404).json({ error: { message: 'Address not found.' } });
    res.json({ address });
  } catch (e) {
    next(e);
  }
};

/** 503 with a readable message when the table is missing, instead of a 500. */
export const addressErrorHandler = (
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof AddressBookUnavailable) {
    return res.status(503).json({ error: { message: err.message } });
  }
  next(err);
};