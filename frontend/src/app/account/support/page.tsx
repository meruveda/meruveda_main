"use client";

import { useAuth } from "@/context/AuthContext";
import { useState, useEffect } from "react";
import { Loader2, MessageSquare, Plus } from "lucide-react";

interface Ticket {
  id: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  created_at: string;
}

export default function SupportPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const { default: axiosInstance } = await import('@/api/axiosInstance');
        const res = await axiosInstance.get('/support/my');
        setTickets(res.data?.data || []);
      } catch (err) {
        console.error("Failed to load tickets", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const { default: axiosInstance } = await import('@/api/axiosInstance');
      const res = await axiosInstance.post('/support', { subject: subject.trim(), message: message.trim() });
      if (res.data?.data) setTickets((prev) => [res.data.data, ...prev]);
      setSubject("");
      setMessage("");
      setShowForm(false);
      setNotice("Request sent. We reply here and on WhatsApp/email.");
    } catch (err: any) {
      setNotice(err?.response?.data?.error?.message || err?.message || "Failed to send request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm py-16 justify-center">
        <Loader2 size={18} className="animate-spin" /> Loading support history...
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-playfair font-bold text-deep-purple mb-1">Help & Support</h1>
          <p className="text-gray-500 text-sm">Order issues, product questions, feedback — everything you sent us.</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-deep-purple text-white hover:bg-deep-purple/90 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} /> New Request
          </button>
        )}
      </div>

      {notice && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 text-sm rounded-xl border border-green-100 font-medium">
          {notice}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100 mb-8 max-w-xl space-y-4">
          <div>
            <label className="block text-gray-700 font-medium mb-1 text-xs">Subject</label>
            <input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Dosage question for joint pain oil"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 outline-none focus:border-gold text-sm"
            />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1 text-xs">Message</label>
            <textarea
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="How can we help?"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 outline-none focus:border-gold text-sm"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-deep-purple text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-2">
              {submitting && <Loader2 size={14} className="animate-spin" />} Send
            </button>
          </div>
        </form>
      )}

      {tickets.length === 0 ? (
        <div className="text-center py-16 bg-ivory/50 rounded-2xl border border-dashed border-gray-200">
          <MessageSquare size={48} className="text-gray-400 mx-auto mb-4" />
          <h3 className="font-playfair font-bold text-deep-purple text-lg mb-1">No requests yet</h3>
          <p className="text-sm text-gray-500">Your support conversations will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t.id} className="border border-gray-100 rounded-xl px-5 py-4 bg-white">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="font-bold text-deep-purple text-sm">{t.subject}</p>
                <span className="px-3 py-1 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-100 capitalize">
                  {t.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-2 leading-relaxed">{t.message}</p>
              <p className="text-[11px] text-gray-400 mt-2">{new Date(t.created_at).toLocaleString("en-IN")}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
