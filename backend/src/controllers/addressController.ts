import { Request, Response, NextFunction } from 'express';
import { addressService, AddressBookUnavailable, type AddressScope } from '../services/addressService';

/**
 * Address book endpoints.
 *
 * Every handler reads the scope from the session and never a user id from the
 * request body, so a customer cannot read or modify another customer's
 * addresses by crafting a request.
 */

/**
 * Whose address book this request is about.
 *
 * A checkout session gets its OWN book (the rows it created); a real account
 * gets its book.
 */
const scope = (req: Request): AddressScope => {
  const session = (req as any).customerSession;
  return {
    userId: String((req as any).user?.id || ''),
    sessionId: session?.id && !session.id.startsWith('user:') ? session.id : null,
    verified: Boolean(session?.verifiedAccount),
  };
};

/** Express 5 types a route param as string | string[]; we only ever expect one. */
const param = (req: Request, name: string): string => String((req.params as any)[name]);

export const listAddresses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ addresses: await addressService.list(scope(req)) });
  } catch (e) {
    next(e);
  }
};

export const createAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, created } = await addressService.create(scope(req), req.body);
    res.status(created ? 201 : 200).json({ address, created });
  } catch (e) {
    next(e);
  }
};

export const updateAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await addressService.update(scope(req), param(req, "id"), req.body);
    if (!address) return res.status(404).json({ error: { message: 'Address not found.' } });
    res.json({ address });
  } catch (e) {
    next(e);
  }
};

export const deleteAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await addressService.remove(scope(req), param(req, "id"));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};

export const setDefaultAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await addressService.setDefault(scope(req), param(req, "id"));
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