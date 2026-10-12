import React, { useState, useEffect } from 'react'
import { HeadphonesIcon, MessageCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { supportService } from '../../services/supportService'
import { SupportTicket, TicketStatus } from '../../types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatDate } from '@meruveda/shared'
import { Modal } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export const SupportPage: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Reply Modal
  const [isReplyOpen, setIsReplyOpen] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null)
  const [replyText, setReplyText] = useState('')

  const fetchTickets = async () => {
    setIsLoading(true)
    try {
      const data = await supportService.getTickets()
      setTickets(data)
    } catch (err) {
      toast.error('Failed to load tickets')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTickets()
  }, [])

  const handleStatusChange = async (id: string, status: TicketStatus) => {
    try {
      await supportService.updateTicketStatus(id, status)
      toast.success(`Ticket marked as ${status}`)
      fetchTickets()
    } catch (err) {
      toast.error('Failed to update status')
    }
  }

  const openReply = (ticket: SupportTicket) => {
    setSelectedTicket(ticket)
    setReplyText(ticket.reply || '')
    setIsReplyOpen(true)
  }

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTicket || !replyText) return

    try {
      await supportService.replyToTicket(selectedTicket.id, replyText)
      toast.success('Reply submitted and marked as Resolved!')
      setIsReplyOpen(false)
      fetchTickets()
    } catch (err) {
      toast.error('Failed to submit reply')
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="page-title">Support Tickets</h1>
        <p className="text-sm text-slate-500">Respond to customer issues, delivery queries, and coupon glitches.</p>
      </div>

      {/* Tickets List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">Ticket</th>
                <th className="p-4">Customer Details</th>
                <th className="p-4">Priority</th>
                <th className="p-4">Received Date</th>
                <th className="p-4">Fulfillment Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading support files...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-400">
                    No active support queries.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/20 text-blue-600 rounded-lg">
                          <HeadphonesIcon className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white line-clamp-1">
                            {t.subject}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">{t.ticketNumber}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div>
                        <p className="font-semibold">{t.customerName}</p>
                        <p className="text-xs text-slate-400">{t.customerEmail}</p>
                      </div>
                    </td>
                    <td className="p-4 font-semibold capitalize text-xs">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                          t.priority === 'urgent' || t.priority === 'high'
                            ? 'bg-red-50 text-red-700'
                            : t.priority === 'medium'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-50 text-slate-700'
                        }`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-slate-500">{formatDate(t.createdAt)}</td>
                    <td className="p-4">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => openReply(t)}
                          className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl"
                        >
                          <MessageCircle className="h-3.5 w-3.5" /> Reply
                        </button>

                        <select
                          value={t.status}
                          onChange={(e) => handleStatusChange(t.id, e.target.value as TicketStatus)}
                          className="input py-1 px-3 text-xs w-28 bg-white dark:bg-slate-800"
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reply Dialog Modal */}
      <Modal
        isOpen={isReplyOpen}
        onClose={() => setIsReplyOpen(false)}
        title={`Support Reply — ${selectedTicket?.ticketNumber}`}
      >
        <form onSubmit={handleReplySubmit} className="space-y-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-850/20 rounded-xl text-xs space-y-1">
            <p className="font-bold">Subject: {selectedTicket?.subject}</p>
            <p className="text-slate-500 font-semibold">{selectedTicket?.customerName} wrote:</p>
            <p className="italic mt-1">"{selectedTicket?.message}"</p>
          </div>

          <div>
            <label className="label">Response message Placeholder</label>
            <textarea
              required
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="e.g. Hello Rahul, thank you for writing to MeruVeda Support..."
              className="input h-36"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => setIsReplyOpen(false)}
              className="btn-outline px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-xs">
              Submit Response
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
export default SupportPage
