import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';

export const getTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*, users(first_name, last_name, email)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const getUserTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const createTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticketData = req.body;
    ticketData.user_id = req.user?.id;

    const { data, error } = await supabase.from('support_tickets').insert(ticketData).select().single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateTicketStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase.from('support_tickets').update({ status }).eq('id', id).select().single();
    if (error) throw error;
    res.json({ data });
  } catch (error) {
    next(error);
  }
};
