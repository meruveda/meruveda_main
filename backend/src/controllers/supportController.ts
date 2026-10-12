import { Request, Response, NextFunction } from 'express';
import { supabase } from '../database/supabase';
import { hasColumn } from '../services/schemaGuard';

// `support_tickets.ticket_number` is a pending DB column. Until it is applied we still
// need a stable, readable ticket id in the admin UI, so the display id is derived from
// the ticket UUID whenever the real column is not there.
const deriveTicketNumber = (ticket: any): string => {
  if (ticket?.ticket_number) return String(ticket.ticket_number);
  const raw = String(ticket?.id || '').replace(/-/g, '').toUpperCase();
  return raw ? `TKT-${raw.slice(0, 8)}` : 'TKT-????????';
};

const withTicketNumber = (ticket: any) => ({ ...ticket, ticket_number: deriveTicketNumber(ticket) });

const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const getTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, priority, search } = req.query;

    let query = supabase
      .from('support_tickets')
      .select('*, users(first_name, last_name, email, phone)')
      .order('created_at', { ascending: false });

    if (status && TICKET_STATUSES.includes(String(status))) {
      query = query.eq('status', String(status));
    }
    if (priority && TICKET_PRIORITIES.includes(String(priority))) {
      query = query.eq('priority', String(priority));
    }
    if (search) {
      const safe = String(search).replace(/[%(),"]/g, '').trim().slice(0, 80);
      if (safe) {
        query = query.or(`subject.ilike.%${safe}%,message.ilike.%${safe}%`);
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({
      data: (data || []).map((t: any) => withTicketNumber(t)),
      total: (data || []).length
    });
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
    res.json({ data: (data || []).map((t: any) => withTicketNumber(t)) });
  } catch (error) {
    next(error);
  }
};

export const createTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subject, message, priority } = req.body || {};

    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: { message: 'Please add a subject for your request.' } });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: { message: 'Please describe your issue before sending.' } });
    }

    // Whitelist the writable fields: a mass-assigned `status`, `user_id`, `id` or
    // `reply` from the client would let anyone forge or pre-resolve tickets.
    const ticketData: any = {
      user_id: req.user?.id,
      subject: String(subject).trim().slice(0, 255),
      message: String(message).trim().slice(0, 5000)
    };
    if (TICKET_PRIORITIES.includes(String(priority))) ticketData.priority = String(priority);
    if (await hasColumn('support_tickets', 'ticket_number')) {
      ticketData.ticket_number = `TKT-${Date.now().toString(36).toUpperCase()}`;
    }

    const { data, error } = await supabase.from('support_tickets').insert(ticketData).select().single();
    if (error) throw error;
    res.status(201).json({ data: withTicketNumber(data) });
  } catch (error) {
    next(error);
  }
};

export const updateTicketStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!TICKET_STATUSES.includes(String(status))) {
      return res.status(400).json({ error: { message: 'Invalid ticket status.' } });
    }

    const { data, error } = await supabase
      .from('support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data: withTicketNumber(data) });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin reply. The `reply` column arrives with the support delta, so the endpoint
 * refuses with an actionable message instead of a PostgREST 500 when it is missing.
 */
export const replyToTicket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { message } = req.body || {};
    const reply = String(message || '').trim();

    if (!reply) {
      return res.status(400).json({ error: { message: 'Please write a reply before sending.' } });
    }

    if (!(await hasColumn('support_tickets', 'reply'))) {
      return res.status(503).json({
        error: {
          message:
            'Support replies are not enabled yet: the `support_tickets.reply` column is missing. Apply backend/database/PENDING_DELTAS.sql, then retry.'
        }
      });
    }

    const { data, error } = await supabase
      .from('support_tickets')
      .update({
        reply: reply.slice(0, 5000),
        // Admin replies resolve the ticket, matching the admin UI's confirmation copy.
        status: 'resolved',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ data: withTicketNumber(data) });
  } catch (error) {
    next(error);
  }
};
