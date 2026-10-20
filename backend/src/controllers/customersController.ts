import { Request, Response, NextFunction } from 'express';
import * as usersRepo from '../database/repos/users';
import * as ordersRepo from '../database/repos/orders';
import * as activityRepo from '../database/repos/activityLogs';
import * as cartRepo from '../database/repos/cart';
import { config } from '../config/env';
import { hasColumn } from '../services/schemaGuard';
import { sendEmail, getPasswordResetTemplate } from '../services/emailService';
import { isPlaceholderEmail } from '../utils/phone';
import {
  buildResetLink,
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from '../utils/resetToken';

export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10, search, role } = req.query;

    // If role is specified and not 'all', filter by it. If not specified, default to 'customer' to keep customers page safe
    const roleFilter =
      role && role !== 'all' ? String(role) : !role ? 'customer' : undefined;

    const safe = search
      ? String(search).replace(/[%(),"]/g, '').trim().slice(0, 80)
      : '';

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 10));

    const { rows: data, count } = await usersRepo.listUsers({
      role: roleFilter,
      search: safe || undefined,
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    const userIds = data.map((u: any) => u.id);

    // Fetch order metrics for returned users
    const orders = await ordersRepo.listByUserIds(userIds);

    // Fetch latest activity log timestamps for returned users
    const logs = await activityRepo.timestampsForUsers(userIds);

    // Remove password hashes and map calculated metrics
    const sanitizedData = data.map((user: any) => {
      const { password_hash, ...rest } = user;

      const userOrders = orders.filter((o: any) => o.user_id === user.id);
      const totalOrders = userOrders.length;
      const lifetimeSpend = userOrders.reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);

      // City: most recent order shipping city, fallback to user city column if present.
      const sortedOrders = [...userOrders].sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const city = sortedOrders[0]?.shipping_address?.city || (user as any).city || '';

      // Display name with sensible fallbacks (guest/OTP users often have empty names).
      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
      const displayName = fullName || user.email || (user.phone ? `Customer ${user.phone}` : 'Guest Customer');

      // Last activity: maximum of user.created_at, user.last_login_at (delta 005;
      // older rows / un-migrated DBs fall back to the legacy `last_login` spelling),
      // latest order created_at, latest activity log created_at
      const toTime = (v: any) => {
        const t = v ? new Date(v).getTime() : NaN;
        return Number.isFinite(t) ? t : 0;
      };
      const orderDates = userOrders.map((o: any) => toTime(o.created_at)).filter(Boolean);
      const logDates = logs.filter((l: any) => l.user_id === user.id).map((l: any) => toTime(l.created_at)).filter(Boolean);
      const lastLoginTime = toTime(user.last_login_at ?? user.last_login);
      const createdAtTime = toTime(user.created_at);

      const maxTime = Math.max(0, createdAtTime, lastLoginTime, ...orderDates, ...logDates);
      const lastLogin = maxTime > 0 ? new Date(maxTime).toISOString() : null;

      return {
        ...rest,
        displayName,
        city,
        totalOrders,
        lifetimeSpend,
        lastLogin
      };
    });

    res.json({
      data: sanitizedData,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: count ? Math.ceil(count / limitNum) : 0
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await usersRepo.findById(
      id as string,
      'id, email, first_name, last_name, phone, role, active, created_at',
    );

    if (!data) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    data.orders = await ordersRepo.listAllForUser(id as string);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateCustomerStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const data = await usersRepo.updateUserReturning(
      id as string,
      { active },
      'id, email, first_name, last_name, role, active',
    );

    if (!data) throw new Error('User not found');
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, first_name, last_name, phone, role, active } = req.body;

    const updates: any = {};
    if (firstName !== undefined) updates.first_name = firstName;
    if (first_name !== undefined) updates.first_name = first_name;
    if (lastName !== undefined) updates.last_name = lastName;
    if (last_name !== undefined) updates.last_name = last_name;
    if (phone !== undefined) updates.phone = phone;
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;

    const data = await usersRepo.updateUserReturning(
      id as string,
      updates,
      'id, email, first_name, last_name, role, active, phone',
    );

    if (!data) throw new Error('User not found');
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await usersRepo.deleteUser(id as string);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin-triggered password reset for a customer.
 *
 * Behaviour (see also authController.forgotPassword, which is the customer
 * self-service path — both share utils/resetToken):
 *   - 32-byte random token; only its SHA-256 hash is stored, 30-minute expiry.
 *   - The stored token is single-use and replaces any earlier one, so a link
 *     issued by support invalidates every previous link for that account.
 *   - The same generic response is returned whether the customer exists, has a
 *     real inbox, or is phone-only — so this endpoint cannot be used to probe
 *     which accounts exist.
 *   - The raw token is NEVER returned in the response (it would land in the
 *     admin UI, browser history and logs). It only travels in the email.
 *   - Rate limited (adminResetPasswordLimiter) on the route.
 */
export const resetUserPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const generic = { success: true, message: 'If the account exists, a password reset link has been sent.' };

    // Delta 007 not applied: no columns to store a token in. Fail soft with the
    // generic reply so the admin UI never reveals schema state.
    if (!(await hasColumn('users', 'reset_password_token')) || !(await hasColumn('users', 'reset_password_expires'))) {
      console.error('[resetUserPassword] users.reset_password_token/expires missing — apply database/deltas/007_mobile_auth.sql.');
      return res.json(generic);
    }

    const user = await usersRepo.findById(id as string, 'id, email, first_name');

    if (!user) {
      console.warn(`[resetUserPassword] no user with id ${id} — generic reply sent.`);
      return res.json(generic);
    }

    const token = generateResetToken();
    await usersRepo.updateUser(user.id, {
      reset_password_token: hashResetToken(token),
      reset_password_expires: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Phone-only / placeholder-inbox accounts have nowhere to receive the link.
    // Support still helps them out of band; the reply does not change.
    if (!user.email || isPlaceholderEmail(user.email)) {
      console.log(`[adminResetPassword] account ${user.id} has no real inbox on file — link not emailed.`);
      return res.json(generic);
    }

    const resetLink = buildResetLink(config.frontendUrl, token);
    const html = getPasswordResetTemplate(resetLink, user.first_name || 'Customer');

    // Await the send so a delivery failure is visible in the admin UI path,
    // but never leak the reason to the caller — still the generic reply.
    try {
      await sendEmail(user.email, 'Reset Your MeruVeda Password', html);
    } catch (mailErr) {
      console.error('[adminResetPassword] failed to send reset email:', mailErr);
    }

    res.json(generic);
  } catch (error) {
    next(error);
  }
};

export const getCustomerAddresses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // We don't have a dedicated addresses table yet, so let's extract them from user's orders
    let data: any[] = [];
    try {
      data = await ordersRepo.listShippingAddresses(id as string);
    } catch {
      return res.json({ data: [] });
    }

    const addresses = [];
    const seen = new Set();

    for (const row of data) {
      if (row.shipping_address) {
        const addr = row.shipping_address;
        // Create a unique key for deduplication
        const key = `${addr.addressLine1}-${addr.city}-${addr.pincode}`;
        if (!seen.has(key)) {
          seen.add(key);
          addresses.push({
            id: key, // Mock ID
            fullName: addr.fullName || '',
            addressLine1: addr.addressLine1 || '',
            addressLine2: addr.addressLine2 || '',
            city: addr.city || '',
            state: addr.state || '',
            pincode: addr.pincode || '',
            country: addr.country || 'India',
            phone: addr.phone || '',
            isDefault: addresses.length === 0, // First one is default
          });
        }
      }
    }

    res.json({ data: addresses });
  } catch (error) {
    next(error);
  }
};

export const getCustomerCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    let data: any[] = [];
    try {
      data = await cartRepo.listForUser(id as string);
    } catch {
      return res.json({ data: [] });
    }

    res.json({ data });
  } catch (error) {
    next(error);
  }
};
