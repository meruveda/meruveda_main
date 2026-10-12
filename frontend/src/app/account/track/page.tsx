"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, PackageSearch, Truck } from "lucide-react";
import axiosInstance from "@/api/axiosInstance";
import { orderService } from "@/services/accountService";
import type { AccountOrder } from "@/types/account";
import { EmptyState, ErrorBox, OrderTimeline, SectionHeader, StatusBadge } from "@/components/account/ui";

function TrackInner() {
  const search = useSearchParams();
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [selectedId, setSelectedId] = useState(search.get("order") || "");
  const [guestRef, setGuestRef] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestResult, setGuestResult] = useState<Record<string, unknown> | null>(null);
  const [guestAwb, setGuestAwb] = useState("");
  const [awbResult, setAwbResult] = useState<Record<string, unknown> | null>(null);
  const [awbLoading, setAwbLoading] = useState(false);
  const [awbError, setAwbError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);

  useEffect(() => {
    orderService
      .myOrders()
      .then((o) => {
        setOrders(o);
        if (!selectedId && o.length > 0) setSelectedId(o[0].id);
      })
      .catch((e) => setError((e as Error)?.message || "Could not load orders."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = orders.find((o) => o.id === selectedId || o.orderNumber === selectedId);

  const guestTrack = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setGuestLoading(true);
    setGuestError(null);
    setGuestResult(null);
    try {
      const res = await axiosInstance.get("/orders/track", { params: { order: guestRef.trim(), phone: guestPhone.trim() } });
      setGuestResult(res.data?.data || null);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setGuestError(err?.response?.data?.error?.message || err?.message || "No order found for these details.");
    } finally {
      setGuestLoading(false);
    }
  };

  const awbTrack = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const awb = guestAwb.trim();
    if (!awb) {
      setAwbError("Please enter a tracking ID (AWB).");
      return;
    }
    setAwbLoading(true);
    setAwbError(null);
    setAwbResult(null);
    try {
      const res = await axiosInstance.get("/orders/track-awb", { params: { awb } });
      setAwbResult(res.data?.data || null);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setAwbError(err?.response?.data?.error?.message || err?.message || "No shipment found for this tracking ID.");
    } finally {
      setAwbLoading(false);
    }
  };

  const input = "w-full border border-gray-300 rounded-lg px-4 py-2.5 outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 text-sm";

  return (
    <div>
      <SectionHeader title="Track Orders" subtitle="Pick one of your orders, or look up any order with its mobile number." />

      {loading ? (
        <p className="flex items-center gap-2 text-gray-500 text-sm py-10 justify-center">
          <Loader2 size={17} className="animate-spin" /> Loading your orders…
        </p>
      ) : error ? (
        <ErrorBox message={error} />
      ) : orders.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Nothing to track yet" message="Orders you place will appear here with live tracking." ctaLabel="Start Shopping" ctaHref="/products" />
      ) : (
        <div className="space-y-5">
          <label className="block max-w-md">
            <span className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wider">Your orders</span>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={input} aria-label="Choose an order to track">
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber} — {new Date(o.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} — ₹{(o.total || 0).toFixed(2)}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="bg-ivory/40 border border-gray-100 rounded-2xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <div>
                  <p className="font-bold text-deep-purple">{selected.orderNumber}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {selected.courierName ? `${selected.courierName} · ` : ""}
                    {selected.awbCode || selected.trackingNumber ? `AWB ${selected.awbCode || selected.trackingNumber}` : "AWB assigns after dispatch"} · ETA{" "}
                    {selected.estimatedDelivery
                      ? new Date(selected.estimatedDelivery).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                      : "—"}
                  </p>
                </div>
                <StatusBadge status={selected.status} />
              </div>
              <div className="overflow-x-auto pb-1">
                <OrderTimeline currentNormalized={selected.normalizedStatus} compact />
              </div>
              <div className="flex gap-2 mt-4 flex-wrap">
                <Link href={`/account/orders/${encodeURIComponent(selected.id)}`} className="flex items-center gap-1.5 px-4 py-2 bg-deep-purple text-white hover:bg-deep-purple/90 rounded-lg text-xs font-bold">
                  <Truck size={14} /> View full details
                </Link>
                {(selected.trackingUrl || selected.trackingNumber) && (
                  <a
                    href={selected.trackingUrl || `https://shiprocket.co/tracking/${selected.trackingNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 border border-gray-200 hover:bg-white rounded-lg text-xs font-semibold text-gray-700 bg-white"
                  >
                    Track on courier site
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Guest lookup — same public endpoint as /track */}
      <div className="mt-8 pt-6 border-t border-gray-100">
        <h2 className="font-playfair font-bold text-deep-purple text-lg mb-1">Look up a different order</h2>
        <p className="text-xs text-gray-500 mb-4">Order number + the mobile number used at checkout. No login needed.</p>
        <form onSubmit={guestTrack} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 max-w-2xl">
          <input value={guestRef} onChange={(e) => setGuestRef(e.target.value)} required placeholder="Order number (e.g. MV-2026-001)" className={input} aria-label="Order number" />
          <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} required placeholder="Mobile number" inputMode="tel" className={input} aria-label="Mobile number" />
          <button type="submit" disabled={guestLoading} className="px-6 py-2.5 bg-gold text-deep-purple hover:bg-gold/90 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap">
            {guestLoading && <Loader2 size={15} className="animate-spin" />} Track
          </button>
        </form>
        {guestError && (
          <div className="mt-4 max-w-2xl">
            <ErrorBox message={guestError} />
          </div>
        )}
        {guestResult && (
          <div className="mt-4 max-w-2xl bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="font-bold text-deep-purple">{String(guestResult.order_number || "")}</p>
              <StatusBadge status={String(guestResult.status || "Placed")} />
            </div>
            <div className="overflow-x-auto mt-4 pb-1">
              <OrderTimeline currentNormalized={String(guestResult.status || "placed").toLowerCase()} compact />
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Courier: <span className="font-semibold text-gray-700">{String((guestResult as Record<string, unknown>).courier_name || "—")}</span>
              {" · "}AWB: <span className="font-mono font-semibold text-gray-700">{String((guestResult as Record<string, unknown>).awb_code || "—")}</span>
            </p>
          </div>
        )}

        <h2 className="font-playfair font-bold text-deep-purple text-lg mb-1 mt-8">Track by tracking ID (AWB)</h2>
        <p className="text-xs text-gray-500 mb-4">Have only the courier tracking ID from your invoice or SMS? Enter it below.</p>
        <form onSubmit={awbTrack} className="grid sm:grid-cols-[1fr_auto] gap-3 max-w-2xl">
          <input value={guestAwb} onChange={(e) => setGuestAwb(e.target.value)} required placeholder="Tracking ID (e.g. 123456789012)" className={`${input} font-mono`} aria-label="Tracking ID (AWB)" />
          <button type="submit" disabled={awbLoading} className="px-6 py-2.5 bg-deep-purple text-white hover:bg-deep-purple/90 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap">
            {awbLoading && <Loader2 size={15} className="animate-spin" />} Track shipment
          </button>
        </form>
        {awbError && (
          <div className="mt-4 max-w-2xl">
            <ErrorBox message={awbError} />
          </div>
        )}
        {awbResult && (
          <div className="mt-4 max-w-2xl bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="font-bold text-deep-purple font-mono">{String(awbResult.awb_code || "")}</p>
              <StatusBadge status={String(awbResult.current_status || awbResult.status || "In transit")} />
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Courier: <span className="font-semibold text-gray-700">{String(awbResult.courier_name || awbResult.courier || "—")}</span>
              {" · "}ETA: <span className="font-semibold text-gray-700">{String(awbResult.etd || awbResult.estimated_delivery || "—")}</span>
            </p>
            {awbResult.tracking_url ? (
              <a href={String(awbResult.tracking_url)} target="_blank" rel="noreferrer" className="inline-block mt-3 text-xs font-bold text-gold hover:underline">
                Track on courier site
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TrackOrdersPage() {
  return (
    <Suspense fallback={<p className="flex items-center gap-2 text-gray-500 text-sm py-10 justify-center"><Loader2 size={17} className="animate-spin" /> Loading tracker…</p>}>
      <TrackInner />
    </Suspense>
  );
}
