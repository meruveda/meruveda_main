"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { XCircle, RefreshCw, Truck, ShoppingBag, Phone, AlertCircle } from "lucide-react";

function CheckoutFailedContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [switchingToCOD, setSwitchingToCOD] = useState(false);

  const orderId = searchParams.get("order_id");
  const reason = searchParams.get("reason") || "Your payment could not be processed.";

  const handleRetryPayment = () => {
    // Go back to checkout — cart should still be intact since we don't clear on PayU initiation
    router.push("/checkout");
  };

  return (
    <div className="min-h-screen bg-ivory/30">
      <div className="container mx-auto px-4 py-16 md:py-24 max-w-xl">
        {/* Failed Banner */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden mb-6">
          <div className="h-2 bg-gradient-to-r from-red-500 via-red-400 to-red-500" />
          <div className="p-8 md:p-10 text-center">
            <div className="w-20 h-20 bg-red-50 border border-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <XCircle size={44} />
            </div>

            <h1 className="text-3xl font-playfair font-bold text-deep-purple mb-2">Payment Failed</h1>
            <p className="text-gray-500 text-sm mb-4">
              Don't worry — your cart is still saved. You can retry or choose another payment option.
            </p>

            {/* Error Reason */}
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700 font-medium mb-6 text-left flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{reason}</span>
            </div>

            {orderId && (
              <p className="text-[11px] font-mono text-gray-400 mb-6 bg-gray-50 border border-gray-100 p-2 rounded-lg inline-block">
                Order Reference: {orderId}
              </p>
            )}
          </div>
        </div>

        {/* Action Options */}
        <div className="space-y-4">
          {/* Primary: Retry Payment */}
          <button
            onClick={handleRetryPayment}
            className="w-full bg-deep-purple text-white hover:bg-deep-purple/90 px-6 py-4 rounded-2xl font-bold transition-all text-sm flex items-center justify-center gap-3 shadow-md"
          >
            <RefreshCw size={18} />
            <div className="text-left">
              <div>Retry Payment via PayU</div>
              <div className="font-normal text-xs text-white/70">Pay with Cards, UPI, NetBanking & more</div>
            </div>
          </button>

          {/* Back to Checkout — there is no cart page anymore; the cart is edited in place on checkout */}
          <Link
            href="/checkout"
            className="w-full border-2 border-gray-200 text-gray-700 hover:border-gold hover:text-gold px-6 py-4 rounded-2xl font-bold transition-all text-sm flex items-center justify-center gap-3"
          >
            <ShoppingBag size={18} />
            <div className="text-left">
              <div>Back to Checkout</div>
              <div className="font-normal text-xs text-gray-400">Your items are still saved in your cart</div>
            </div>
          </Link>

          {/* Divider */}
          <div className="relative flex items-center gap-3 py-2">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Or pay a different way</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Switch to COD */}
          <Link
            href="/checkout"
            className="w-full bg-amber-50 border-2 border-amber-200 text-amber-800 hover:bg-amber-100 px-6 py-4 rounded-2xl font-bold transition-all text-sm flex items-center justify-center gap-3"
          >
            <Truck size={18} />
            <div className="text-left">
              <div>Switch to Cash on Delivery</div>
              <div className="font-normal text-xs text-amber-600">Pay ₹50 COD fee when your order arrives</div>
            </div>
          </Link>
        </div>

        {/* Help */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400 mb-2">Need help with your payment?</p>
          <Link href="/contact" className="text-xs text-gold font-semibold hover:underline flex items-center justify-center gap-1">
            <Phone size={12} /> Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutFailedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-gold border-t-transparent rounded-full" />
      </div>
    }>
      <CheckoutFailedContent />
    </Suspense>
  );
}
