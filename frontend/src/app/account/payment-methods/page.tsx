"use client";

import { useEffect, useState } from "react";
import { CreditCard, Plus, ShieldCheck } from "lucide-react";
import { paymentService, validateNewCard } from "@/services/accountService";
import type { SavedCard } from "@/types/account";
import { ConfirmDialog, EmptyState, Notice, SectionHeader } from "@/components/account/ui";

export default function PaymentMethodsPage() {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ cardHolder: "", cardNumber: "", expiry: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    setCards(paymentService.list());
  }, []);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const err = validateNewCard(form.cardHolder, form.cardNumber, form.expiry);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    // NOTE: demo vault only — a real integration tokenises via the PSP and
    // stores only the last4 + network token server-side. CVV is never stored.
    paymentService.add(form.cardHolder, form.cardNumber, form.expiry);
    setCards(paymentService.list());
    setForm({ cardHolder: "", cardNumber: "", expiry: "" });
    setShowForm(false);
    setNotice("Payment method saved. Only the last 4 digits are kept.");
    setTimeout(() => setNotice(null), 3500);
  };

  const confirmDelete = () => {
    if (!confirmId) return;
    setCards(paymentService.remove(confirmId));
    setConfirmId(null);
    setNotice("Payment method removed.");
    setTimeout(() => setNotice(null), 3000);
  };

  const input = "w-full border border-gray-300 rounded-lg px-4 py-2 outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all text-sm";
  const label = "block text-gray-700 font-medium mb-1 text-xs";

  return (
    <div>
      <SectionHeader
        title="Payment Methods"
        subtitle="Saved cards for faster checkout. Full numbers are never shown or stored."
        action={
          !showForm ? (
            <button onClick={() => { setShowForm(true); setFormError(null); }} className="bg-deep-purple text-white hover:bg-deep-purple/90 px-4 py-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap">
              <Plus size={14} /> Add Payment Method
            </button>
          ) : undefined
        }
      />

      {notice && <Notice>{notice}</Notice>}

      <p className="flex items-start gap-2 text-xs text-gray-500 bg-ivory/60 border border-gray-100 rounded-xl px-4 py-3 mb-6">
        <ShieldCheck size={15} className="text-sage shrink-0 mt-0.5" />
        UPI and Cash on Delivery are always available at checkout — no need to save anything for those.
      </p>

      {showForm && (
        <form onSubmit={submit} noValidate className="bg-gray-50/50 p-5 md:p-6 rounded-2xl border border-gray-100 mb-8 max-w-xl space-y-4">
          <h3 className="font-playfair font-bold text-deep-purple text-lg">Add card</h3>
          {formError && (
            <p className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium" role="alert">{formError}</p>
          )}
          <div>
            <label className={label} htmlFor="pm-name">Name on card *</label>
            <input id="pm-name" className={input} value={form.cardHolder} onChange={(e) => setForm((p) => ({ ...p, cardHolder: e.target.value }))} placeholder="Aarav Mehta" autoComplete="cc-name" />
          </div>
          <div>
            <label className={label} htmlFor="pm-num">Card number *</label>
            <input id="pm-num" className={input} value={form.cardNumber} onChange={(e) => setForm((p) => ({ ...p, cardNumber: e.target.value.replace(/[^\d\s]/g, "").slice(0, 19) }))} placeholder="4111 2222 3333 4444" inputMode="numeric" autoComplete="cc-number" />
            <p className="text-[11px] text-gray-400 mt-1">Only the last 4 digits are kept. CVV is never asked for or stored.</p>
          </div>
          <div>
            <label className={label} htmlFor="pm-exp">Expiry (MM/YY) *</label>
            <input id="pm-exp" className={input} value={form.expiry} onChange={(e) => setForm((p) => ({ ...p, expiry: e.target.value }))} placeholder="MM/YY" maxLength={5} inputMode="numeric" autoComplete="cc-exp" />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2.5 border border-gray-200 hover:bg-gray-100 rounded-lg text-xs font-bold text-gray-700">Cancel</button>
            <button type="submit" className="px-5 py-2.5 bg-deep-purple text-white hover:bg-deep-purple/90 rounded-lg text-xs font-bold">Save Card</button>
          </div>
        </form>
      )}

      {cards.length === 0 && !showForm ? (
        <EmptyState
          icon={CreditCard}
          title="No saved payment methods"
          message="Save a card to check out faster. PayU, UPI and COD always work without saving anything."
          ctaLabel="Add Your First Card"
          onCta={() => setShowForm(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {cards.map((card) => (
            <div key={card.id} className={`p-5 md:p-6 rounded-2xl border bg-white shadow-sm ${card.isDefault ? "border-gold bg-gold/5" : "border-gray-100"}`}>
              <div className="flex justify-between items-start mb-5 gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-10 px-2 h-6 bg-deep-purple rounded flex items-center justify-center text-white text-[9px] font-bold tracking-widest uppercase">
                    {card.cardType}
                  </span>
                  <span className="font-semibold text-deep-purple text-sm">{card.cardType}</span>
                  {card.isDefault && (
                    <span className="bg-gold/15 text-gold text-[10px] font-bold px-2 py-0.5 rounded-full border border-gold/30">Default</span>
                  )}
                </div>
                <button onClick={() => setConfirmId(card.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold" aria-label={`Remove ${card.cardType} ending ${card.last4}`}>
                  Remove
                </button>
              </div>
              <p className="text-sm font-mono font-semibold text-gray-800 tracking-wider mb-3">{card.masked}</p>
              <div className="flex justify-between text-xs text-gray-500">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Card holder</p>
                  <p className="font-medium text-gray-800">{card.cardHolder}</p>
                </div>
                {card.expiry && (
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Expires</p>
                    <p className="font-medium text-gray-800">{card.expiry}</p>
                  </div>
                )}
              </div>
              {!card.isDefault && (
                <button onClick={() => setCards(paymentService.setDefault(card.id))} className="mt-5 text-xs text-gold hover:underline font-bold">
                  Set as Default
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Remove this payment method?"
        message="It will no longer be offered at checkout. This cannot be undone."
        confirmLabel="Remove"
        onConfirm={confirmDelete}
        onClose={() => setConfirmId(null)}
      />
    </div>
  );
}
