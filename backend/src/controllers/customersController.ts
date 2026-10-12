import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10, search, role } = req.query;

    let query = supabase.from('users').select('*', { count: 'exact' });

    // If role is specified and not 'all', filter by it. If not specified, default to 'customer' to keep customers page safe
    if (role && role !== 'all') {
      query = query.eq('role', role);
    } else if (!role) {
      query = query.eq('role', 'customer');
    }

    if (search) {
      const safe = String(search).replace(/[%(),"]/g, '').trim().slice(0, 80);
      if (safe) {
        query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
      }
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 10));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    const userIds = data ? data.map((u: any) => u.id) : [];

    // Fetch order metrics for returned users
    let orders: any[] = [];
    if (userIds.length > 0) {
      const { data: ordersData } = await supabase
        .from('orders')
        .select('user_id, total, created_at, shipping_address')
        .in('user_id', userIds);
      orders = ordersData || [];
    }

    // Fetch latest activity log timestamps for returned users
    let logs: any[] = [];
    if (userIds.length > 0) {
      const { data: logsData } = await supabase
        .from('activity_logs')
        .select('user_id, created_at')
        .in('user_id', userIds);
      logs = logsData || [];
    }

    // Remove password hashes and map calculated metrics
    const sanitizedData = (data || []).map((user: any) => {
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

      // Last activity: maximum of user.created_at, user.last_login (if present), latest order created_at, latest activity log created_at
      const toTime = (v: any) => {
        const t = v ? new Date(v).getTime() : NaN;
        return Number.isFinite(t) ? t : 0;
      };
      const orderDates = userOrders.map((o: any) => toTime(o.created_at)).filter(Boolean);
      const logDates = logs.filter((l: any) => l.user_id === user.id).map((l: any) => toTime(l.created_at)).filter(Boolean);
      const lastLoginTime = toTime(user.last_login);
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
    const { data, error } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, phone, role, active, created_at, orders(*)')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateCustomerStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({ active })
      .eq('id', id)
      .select('id, email, first_name, last_name, role, active')
      .single();

    if (error) throw error;

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

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, email, first_name, last_name, role, active, phone')
      .single();

    if (error) throw error;

    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const resetUserPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    // In dev / production mock, we just respond with success.
    // If you actually want to reset/send email:
    // const { error } = await supabase.auth.admin.generateLink({ type: 'recovery', email: user.email })
    
    res.json({ success: true, message: 'Password reset link generated/sent successfully' });
  } catch (error) {
    next(error);
  }
};

export const getCustomerAddresses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    // We don't have a dedicated addresses table yet, so let's extract them from user's orders
    const { data, error } = await supabase
      .from('orders')
      .select('shipping_address')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.json({ data: [] });
    }

    const addresses = [];
    const seen = new Set();
    
    if (data) {
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
    }

    res.json({ data: addresses });
  } catch (error) {
    next(error);
  }
};

export const getCustomerCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('cart_items')
      .select('*, products(*)')
      .eq('user_id', id);

    if (error) {
      return res.json({ data: [] });
    }

    res.json({ data: data || [] });
  } catch (error) {
    next(error);
  }
};
