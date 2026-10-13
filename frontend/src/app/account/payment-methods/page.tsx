"use client";

import { ShieldCheck } from "lucide-react";
import { SectionHeader } from "@/components/account/ui";

/**
 * This page intentionally collects NOTHING.
 *
 * It previously hosted a localStorage "card vault" (card number / name /
 * expiry inputs + a saved-cards feature). The vault is removed: cards are
 * entered only on PayU's hosted payment page during checkout. Any leftover
 * vault keys are wiped from the browser by <CardVaultCleanup /> on app load.
 */
export default function PaymentMethodsPage() {
  return (
    <div>
      <SectionHeader
        title="Payment Methods"
        subtitle="How card payments are handled at MeruVeda."
      />

      <div className="max-w-xl bg-gray-50/50 border border-gray-100 rounded-2xl p-6 md:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-deep-purple/10 text-deep-purple flex items-center justify-center shrink-0">
            <ShieldCheck size={18} />
          </span>
          <h3 className="font-playfair font-bold text-deep-purple text-lg leading-snug">
            Payments are handled securely at PayU checkout
          </h3>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed">
          MeruVeda never collects or stores card details on this site. When you
          choose &ldquo;Pay Online&rdquo; at checkout, you are taken to
          PayU&rsquo;s hosted payment page, where your card number, expiry and
          CVV are entered directly on PayU&rsquo;s encrypted page.
        </p>

        <p className="flex items-start gap-2 text-xs text-gray-500 bg-ivory/60 border border-gray-100 rounded-xl px-4 py-3">
          <ShieldCheck size={15} className="text-sage shrink-0 mt-0.5" />
          UPI and Cash on Delivery are always available at checkout — no card
          details needed for those either.
        </p>
      </div>
    </div>
  );
}
