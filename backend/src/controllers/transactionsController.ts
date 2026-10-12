import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    let query = supabase.from('transactions').select('*, users(first_name, last_name), orders(order_number)').order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const formatted = data?.map((t: any) => {
      let status = t.status;
      if (t.status === 'success') {
        const isCOD = t.payment_method === 'Cash On Delivery' || String(t.payment_method).toUpperCase() === 'COD';
        if (isCOD) {
          status = 'collected';
        } else {
          status = 'captured';
        }
      } else if (t.status === 'failed') {
        if (t.metadata?.detailed_status === 'hash_mismatch') {
          status = 'hash_mismatch';
        }
      }
      return {
        ...t,
        status
      };
    }) || [];

    res.json({ data: formatted });
  } catch (error) {
    next(error);
  }
};

export const createTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txData = req.body;
    txData.user_id = req.user?.id;

    const { data, error } = await supabase.from('transactions').insert(txData).select().single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateTransactionStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, gateway_transaction_id } = req.body;

    const updates: any = { status };
    if (gateway_transaction_id) updates.gateway_transaction_id = gateway_transaction_id;

    const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select().single();
    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};
