"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import axiosInstance from "@/api/axiosInstance";

function PayUCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processCallback = async () => {
      try {
        // Collect all POST query/form fields passed by PayU via searchParams or state
        const payload: Record<string, string> = {};
        searchParams.forEach((value, key) => {
          payload[key] = value;
        });

        // Fallback verification path: the primary flow is PayU posting the
        // browser directly to the backend callback, which 302-redirects to
        // /checkout/success/[orderId] after verifying the hash server-side.
        // This page only runs if the gateway returns here instead.
        // Send to backend callback endpoint to verify hash and update order status.
        // NOTE: no "success" navigation happens unless the backend confirms it.
        const response = await axiosInstance.post("/payu/callback", payload, {
          // The backend answers with a redirect, not JSON. Don't follow it
          // into a failed page render — inspect the outcome instead.
          maxRedirects: 0,
          validateStatus: (s) => s < 400,
        });
        const result = response.data;

        // Backend redirect responses carry no JSON body; a 3xx here means the
        // browser already navigated. Only JSON { success, orderId } counts.
        const orderId = result?.orderId || payload.txnid || "";
        if (result && result.success && orderId) {
          router.replace(`/checkout/success/${orderId}`);
        } else if (result && result.success === false) {
          router.replace(`/checkout/failed?order_id=${orderId}&reason=${encodeURIComponent(result.message || 'Payment failed')}`);
        } else if (payload.txnid || orderId) {
          // The backend answered with its redirect (verification already ran
          // server-side) but this page is still mounted — e.g. the gateway
          // returned the laptop browser here. Poll the verified status by
          // order number and route exactly once from server truth.
          const ref = encodeURIComponent(String(payload.txnid || orderId));
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const st = await axiosInstance.get(`/payu/status/${ref}`);
              const d = st.data?.data;
              if (d?.paid && d?.orderId) {
                router.replace(`/checkout/success/${d.orderId}`);
                return;
              }
              if (d?.failed) {
                router.replace(`/checkout/failed?order_id=${d.orderId || ""}&reason=${encodeURIComponent("Payment was unsuccessful or cancelled.")}`);
                return;
              }
            } catch {
              /* keep polling */
            }
          }
          setError("Payment is being verified. If this page does not change, check your order history.");
        } else {
          // Non-JSON (redirect) response: verification already happened
          // server-side and the browser is navigating — stay put briefly,
          // then fall back to order lookup via txnid if still here.
          setError("Payment is being verified. If this page does not change, check your order history.");
        }
      } catch (err: any) {
        // A 3xx thrown by maxRedirects:0 means the backend issued its
        // redirect (success or failed page) — let the navigation proceed.
        const status = err?.response?.status;
        const location = err?.response?.headers?.location;
        if (status && status >= 300 && status < 400 && location) {
          window.location.href = location;
          return;
        }
        console.error("PayU callback error", err);
        setError("Failed to process payment callback.");
      }
    };

    processCallback();
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-xl font-bold text-red-600 mb-2">Payment Verification Error</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={() => router.push("/checkout")}
          className="bg-deep-purple text-white px-6 py-2 rounded-lg font-bold"
        >
          Return to Checkout
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
      <Loader2 size={40} className="animate-spin text-gold mb-4" />
      <h2 className="text-xl font-playfair font-bold text-deep-purple">Verifying PayU Payment...</h2>
      <p className="text-gray-500 text-sm mt-2">Please do not refresh or close this window.</p>
    </div>
  );
}

export default function PayUCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-gold" />
      </div>
    }>
      <PayUCallbackContent />
    </Suspense>
  );
}
