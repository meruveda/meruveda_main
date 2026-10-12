"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Package, Search, Loader2, ExternalLink, MapPin } from "lucide-react";
import axiosInstance from "@/api/axiosInstance";

interface TrackingLog {
  activity: string;
  location?: string | null;
  created_at: string;
}

interface TrackingResult {
  order_number: string;
  status: string;
  payment_status?: string;
  created_at: string;
  delivered_at?: string | null;
  awb_code?: string | null;
  courier_name?: string | null;
  tracking_url?: string | null;
  tracking_status?: string | null;
  estimated_delivery?: string | null;
  last_tracking_update?: string | null;
  shipping_address?: { city?: string; state?: string; zipCode?: string };
  tracking_history?: TrackingLog[];
}

const STATUS_STEPS = [
  { name: "Order Placed" },
  { name: "Packed", statuses: ["Packed", "Shipped", "In Transit", "Out For Delivery", "Delivered"] },
  { name: "Courier Assigned" },
  { name: "Picked Up", statuses: ["Picked Up", "Shipped", "In Transit", "Out For Delivery", "Delivered"] },
  { name: "In Transit", statuses: ["In Transit", "Out For Delivery", "Delivered"] },
  { name: "Out For Delivery", statuses: ["Out For Delivery", "Delivered"] },
  { name: "Delivered", statuses: ["Delivered"] },
];

function getStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case "pending":
      return "bg-amber-50 text-amber-700 border-amber-100";
    case "confirmed":
    case "processing":
      return "bg-blue-50 text-blue-700 border-blue-100";
    case "shipped":
      return "bg-purple-50 text-purple-700 border-purple-100";
    case "delivered":
      return "bg-green-50 text-green-700 border-green-100";
    case "cancelled":
      return "bg-red-50 text-red-700 border-red-100";
    default:
      return "bg-gray-50 text-gray-700 border-gray-100";
  }
}

function isStepDone(step: (typeof STATUS_STEPS)[number], order: TrackingResult, hasAwb: boolean) {
  if (step.name === "Order Placed") return true;
  if (step.name === "Courier Assigned") return hasAwb;
  if (step.statuses) return step.statuses.includes(order.status);
  return false;
}

export default function TrackOrderPage() {
  const [mode, setMode] = useState<"order" | "awb">("order");
  const [orderRef, setOrderRef] = useState("");
  const [phone, setPhone] = useState("");
  const [awb, setAwb] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [liveAwb, setLiveAwb] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLiveAwb(false);
    setLoading(true);
    try {
      if (mode === "awb") {
        const code = awb.trim();
        if (!code) {
          setError("Please enter a tracking ID (AWB).");
          return;
        }
        const response = await axiosInstance.get("/orders/track-awb", {
          params: { awb: code },
        });
        const d = response.data?.data;
        if (!d) {
          setError("No shipment found for this tracking ID. Check the AWB and try again.");
          return;
        }
        setLiveAwb(true);
        setResult({
          order_number: d.awb_code || code,
          status: d.current_status || d.status || "In Transit",
          awb_code: d.awb_code || code,
          courier_name: d.courier_name,
          tracking_url: d.tracking_url,
          tracking_status: d.tracking_status || d.current_status,
          estimated_delivery: d.estimated_delivery,
          last_tracking_update: null,
          created_at: new Date().toISOString(),
          tracking_history: d.tracking_history || [],
        } as TrackingResult);
        return;
      }
      const response = await axiosInstance.get("/orders/track", {
        params: { order: orderRef.trim(), phone: phone.trim() },
      });
      setResult(response.data?.data ?? null);
      if (!response.data?.data) setError("No order found for these details.");
    } catch (err: any) {
      setError(
        err.response?.data?.error?.message ||
          err.message ||
          "Unable to find that order. Please check the details and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const hasAwb = Boolean(result?.awb_code);
  const history = (result?.tracking_history || [])
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="container mx-auto px-6 py-12 md:py-16 max-w-4xl">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-playfair font-bold text-deep-purple mb-3">Track Your Order</h1>
        <p className="text-gray-600">
          {mode === "awb"
            ? "Enter your tracking ID (AWB) for live courier status. No login required."
            : "Enter your order number and the mobile number used at checkout. No login required."}
        </p>
        <div className="inline-flex mt-5 bg-gray-100 rounded-full p-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => { setMode("order"); setError(null); setResult(null); }}
            className={`px-5 py-2 rounded-full transition ${mode === "order" ? "bg-white shadow text-deep-purple" : "text-gray-500"}`}
          >
            Order + Mobile
          </button>
          <button
            type="button"
            onClick={() => { setMode("awb"); setError(null); setResult(null); }}
            className={`px-5 py-2 rounded-full transition ${mode === "awb" ? "bg-white shadow text-deep-purple" : "text-gray-500"}`}
          >
            Tracking ID (AWB)
          </button>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8 space-y-5"
      >
        {mode === "awb" ? (
          <div>
            <label htmlFor="awb" className="block text-sm font-semibold text-deep-purple mb-2">
              Tracking ID (AWB)
            </label>
            <input
              id="awb"
              type="text"
              required
              value={awb}
              onChange={(e) => setAwb(e.target.value)}
              placeholder="e.g. 123456789012"
              className="w-full h-12 px-4 rounded-lg border border-gray-300 focus:border-gold focus:ring-2 focus:ring-gold/30 outline-none transition font-mono"
            />
            <p className="text-xs text-gray-500 mt-2">Find it in your shipping confirmation SMS / email or invoice.</p>
          </div>
        ) : (
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="orderRef" className="block text-sm font-semibold text-deep-purple mb-2">
              Order Number
            </label>
            <input
              id="orderRef"
              type="text"
              required
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder="e.g. MV-10023"
              className="w-full h-12 px-4 rounded-lg border border-gray-300 focus:border-gold focus:ring-2 focus:ring-gold/30 outline-none transition"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-semibold text-deep-purple mb-2">
              Mobile Number
            </label>
            <input
              id="phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile number"
              className="w-full h-12 px-4 rounded-lg border border-gray-300 focus:border-gold focus:ring-2 focus:ring-gold/30 outline-none transition"
            />
          </div>
        </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-12 px-8 bg-gold text-deep-purple font-bold rounded-lg hover:bg-gold-light transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
          {loading ? "Searching..." : mode === "awb" ? "Track Shipment" : "Track Order"}
        </button>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
            {error}
          </p>
        )}
      </form>

      {result && (
        <div className="mt-8 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 md:px-8 py-6 border-b border-gray-100 bg-ivory/60">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-deep-purple text-white flex items-center justify-center">
                <Package size={18} />
              </span>
              <div>
                <p className="font-bold text-deep-purple">{result.order_number}</p>
                <p className="text-xs text-gray-500">
                  {liveAwb ? (
                    <>Live courier tracking{result.shipping_address?.city ? ` · ${result.shipping_address.city}` : ""}</>
                  ) : (
                    <>Placed on{" "}
                    {new Date(result.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {result.shipping_address?.city ? ` · ${result.shipping_address.city}` : ""}</>
                  )}
                </p>
              </div>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(result.status)}`}
            >
              {result.status}{liveAwb ? " · Live" : ""}
            </span>
          </div>

          <div className="px-6 md:px-8 py-6">
            <h5 className="font-bold text-deep-purple mb-4 uppercase tracking-wider text-[10px]">
              Shipment Status
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-7 gap-4 text-center">
              {STATUS_STEPS.map((step, idx) => {
                const done = isStepDone(step, result, hasAwb);
                return (
                  <div key={idx} className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                        done ? "bg-deep-purple text-white" : "bg-gray-200 text-gray-400"
                      }`}
                    >
                      {done ? "✓" : idx + 1}
                    </div>
                    <p
                      className={`mt-2 text-[10px] font-semibold leading-tight ${
                        done ? "text-deep-purple" : "text-gray-400"
                      }`}
                    >
                      {step.name}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              {result.courier_name && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                    Courier
                  </p>
                  <p className="text-sm font-semibold text-deep-purple">{result.courier_name}</p>
                  {result.awb_code && (
                    <p className="text-xs text-gray-600 font-mono mt-1">AWB: {result.awb_code}</p>
                  )}
                </div>
              )}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                  {result.status === "Delivered" ? "Delivered On" : "Estimated Delivery"}
                </p>
                <p className="text-sm font-semibold text-deep-purple">
                  {(result.status === "Delivered" ? result.delivered_at : result.estimated_delivery)
                    ? new Date(
                        (result.status === "Delivered"
                          ? result.delivered_at
                          : result.estimated_delivery) as string
                      ).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "Will be updated shortly"}
                </p>
              </div>
            </div>

            {result.tracking_url && (
              <a
                href={result.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-gold hover:text-gold-light transition-colors"
              >
                View detailed courier tracking
                <ExternalLink size={15} />
              </a>
            )}

            {history.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h6 className="font-semibold text-deep-purple text-[10px] uppercase tracking-wider mb-4">
                  Live Updates
                </h6>
                <div className="relative border-l-2 border-gray-200 pl-5 space-y-4">
                  {history.map((log, idx) => (
                    <div key={idx} className="relative">
                      <span className="absolute -left-[26px] top-1 bg-deep-purple h-2 w-2 rounded-full border border-white" />
                      <div className="text-[12px]">
                        <p className="font-bold text-gray-800">{log.activity}</p>
                        {log.location && (
                          <p className="text-gray-500 text-[11px] inline-flex items-center gap-1">
                            <MapPin size={11} /> {log.location}
                          </p>
                        )}
                        <p className="text-[11px] text-gray-400">
                          {new Date(log.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 text-center text-sm text-gray-500">
        Need help?{" "}
        <Link href="/contact" className="text-gold font-semibold hover:underline">
          Contact our support team
        </Link>
      </div>
    </div>
  );
}
