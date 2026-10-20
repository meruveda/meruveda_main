import { Request, Response, NextFunction } from 'express';
import * as supportRepo from '../database/repos/support';
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

    const safe = search
      ? String(search).replace(/[%(),"]/g, '').trim().slice(0, 80)
      : '';

    const data = await supportRepo.listTickets({
      status: status && TICKET_STATUSES.includes(String(status)) ? String(status) : undefined,
      priority:
        priority && TICKET_PRIORITIES.includes(String(priority)) ? String(priority) : undefined,
      search: safe || undefined,
    });

    res.json({
      data: data.map((t: any) => withTicketNumber(t)),
      total: data.length
    });
  } catch (error) {
    next(error);
  }
};

export const getUserTickets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const data = await supportRepo.listForUser(userId as string);
    res.json({ data: data.map((t: any) => withTicketNumber(t)) });
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

    const data = await supportRepo.insertTicket(ticketData);
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

    const data = await supportRepo.updateTicket(id as string, {
      status,
      updated_at: new Date().toISOString(),
    });
    if (!data) throw new Error('Ticket not found');
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

    const data = await supportRepo.updateTicket(id as string, {
      reply: reply.slice(0, 5000),
      // Admin replies resolve the ticket, matching the admin UI's confirmation copy.
      status: 'resolved',
      updated_at: new Date().toISOString()
    });

    if (!data) throw new Error('Ticket not found');
    res.json({ data: withTicketNumber(data) });
  } catch (error) {
    next(error);
  }
};
