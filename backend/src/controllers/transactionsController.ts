import { Request, Response, NextFunction } from 'express';
import * as transactionsRepo from '../database/repos/transactions';

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query;
    const data = await transactionsRepo.listTransactions(status as string | undefined);

    const formatted = data.map((t: any) => {
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
    });

    res.json({ data: formatted });
  } catch (error) {
    next(error);
  }
};

export const createTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};

    // Whitelist: only the money-bearing columns an admin/manual entry may set.
    // Everything else (id, created_at, type, â€¦) comes from the DB defaults.
    const txData: any = {
      user_id: req.user?.id,
      order_id: body.order_id || null,
      amount: body.amount,
      currency: body.currency || 'INR',
      payment_method: body.payment_method,
      payment_gateway: body.payment_gateway || null,
      gateway_transaction_id: body.gateway_transaction_id || null,
      status: body.status || 'pending'
    };

    if (txData.amount === undefined || txData.amount === null) {
      return res.status(400).json({ error: { message: 'Transaction amount is required.' } });
    }
    if (!txData.payment_method) {
      return res.status(400).json({ error: { message: 'Transaction payment method is required.' } });
    }

    const data = await transactionsRepo.insertTransaction(txData);
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

    const data = await transactionsRepo.updateTransaction(id as string, updates);
    if (!data) throw new Error('Transaction not found');
    res.json({ data });
  } catch (error) {
    next(error);
  }
};
