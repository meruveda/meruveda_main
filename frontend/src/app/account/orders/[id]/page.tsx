"use client";

import { use, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Star,
  Truck,
  Wallet,
} from "lucide-react";
import { orderService } from "@/services/accountService";
import { downloadInvoicePdf } from "@/services/invoiceDownload";
import type { AccountOrder } from "@/types/account";
import { Toast, useToast } from "@/components/ui/Toast";
import {
  ErrorBox,
  LoadingRow,
  OrderTimeline,
  StatusBadge,
} from "@/components/account/ui";

const fmt = (d?: string) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";
const fmtDT = (d?: string) =>
  d
    ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const orderId = decodeURIComponent(id);
  const router = useRouter();
  const [order, setOrder] = useState<AccountOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrder(await orderService.byId(orderId));
    } catch (e) {
      setError((e as Error)?.message || "Order not found.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Download the one canonical invoice PDF.
   *
   * This used to fall back to `window.print()` on any error, which printed the
   * "My Orders" page instead of an invoice — the browser dialog appeared to
   * work while producing a document with no invoice on it. There is no print
   * fallback: the backend serves the same PDF the customer received on WhatsApp,
   * or it fails, and the failure is reported.
   */
  const handleDownloadInvoice = async () => {
    setDownloadingInvoice(true);
    try {
      await downloadInvoicePdf(orderId, order?.orderNumber || orderId);
    } catch (e) {
      showToast((e as Error)?.message || "Could not download invoice. Please try again.", "error");
    } finally {
      setDownloadingInvoice(false);
    }
  };

  const copyTracking = async () => {
    const code = order?.awbCode || order?.trackingNumber;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (loading) return <LoadingRow label="Loading order details…" />;
  if (error || !order) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-deep-purple">
          <ArrowLeft size={14} /> Back to orders
        </button>
        <ErrorBox message={error || "Order not found."} onRetry={load} />
      </div>
    );
  }

  const trackingCode = order.awbCode || order.trackingNumber;
  const canReview = order.normalizedStatus === "delivered";

  return (
    <div className="space-y-6">
      <Toast toast={toast} onDismiss={() => showToast(null)} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={() => router.push("/account/orders")} className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-deep-purple transition-colors">
          <ArrowLeft size={14} /> All orders
        </button>
        <div className="flex gap-2">
          {/* Always available: the invoice is issued at order creation for
              every order, COD and prepaid alike. The only disabled state is the
              in-flight spinner while the file is fetched. */}
          <button
            onClick={handleDownloadInvoice}
            disabled={downloadingInvoice}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-semibold text-gray-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {downloadingInvoice ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Downloading…
              </>
            ) : (
              <>
                <Download size={14} /> Download invoice
              </>
            )}
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-playfair font-bold text-deep-purple truncate">Order {order.orderNumber}</h1>
          <p className="text-xs text-gray-500 mt-1">
            Placed {fmt(order.date)} · {order.items.reduce((n, i) => n + i.quantity, 0)} item(s) · Total ₹{(order.total || 0).toFixed(2)}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Tracking timeline */}
      <section className="bg-ivory/40 border border-gray-100 rounded-2xl p-5 md:p-6" aria-label="Order tracking">
        <h2 className="font-bold text-deep-purple text-sm uppercase tracking-wider mb-4">Tracking</h2>
        <div className="overflow-x-auto pb-1">
          <OrderTimeline currentNormalized={order.normalizedStatus} compact />
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5 text-xs">
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Courier</p>
            <p className="font-semibold text-deep-purple flex items-center gap-1.5">
              <Truck size={14} className="text-gold" /> {order.courierName || "Assigning soon"}
            </p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Tracking ID</p>
            {trackingCode ? (
              <button onClick={copyTracking} className="font-mono font-semibold text-deep-purple flex items-center gap-1.5 hover:text-gold" title="Copy">
                {trackingCode} <Copy size={13} className="text-gray-400" />
                {copied && <span className="text-[10px] text-green-600 font-sans">Copied</span>}
              </button>
            ) : (
              <p className="font-semibold text-gray-400">Available after dispatch</p>
            )}
          </div>
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Estimated delivery</p>
            <p className="font-semibold text-deep-purple">{fmt(order.estimatedDelivery || order.date)}</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Last update</p>
            <p className="font-semibold text-deep-purple">{fmtDT(order.lastTrackingUpdate)}</p>
          </div>
        </div>

        <div className="flex gap-2 mt-4 flex-wrap print:hidden">
          {order.trackingUrl ? (
            <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-4 py-2 bg-gold text-deep-purple hover:bg-gold/90 rounded-lg text-xs font-bold transition-colors">
              <Truck size={14} /> Track Package <ExternalLink size={12} />
            </a>
          ) : trackingCode ? (
            <a href={`https://shiprocket.co/tracking/${trackingCode}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-4 py-2 bg-gold text-deep-purple hover:bg-gold/90 rounded-lg text-xs font-bold transition-colors">
              <Truck size={14} /> Track Package <ExternalLink size={12} />
            </a>
          ) : null}
          <Link href="/account/track" className="px-4 py-2 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-semibold text-gray-700">
            Open full tracker
          </Link>
        </div>

        {order.trackingHistory && order.trackingHistory.length > 0 && (
          <div className="mt-6 pt-5 border-t border-gray-200">
            <h3 className="font-semibold text-deep-purple text-[11px] uppercase tracking-wider mb-3">Live updates</h3>
            <div className="relative border-l-2 border-gray-200 pl-4 space-y-4 ml-1.5">
              {[...order.trackingHistory]
                .sort((a, b) => +new Date(b.created_at || b.date || 0) - +new Date(a.created_at || a.date || 0))
                .slice(0, 12)
                .map((log, i) => (
                  <div key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 bg-deep-purple h-2 w-2 rounded-full ring-2 ring-white" />
                    <p className="font-bold text-gray-800 text-xs">{log.activity || log.status || "Update"}</p>
                    {log.location && <p className="text-gray-500 text-[11px]">{log.location}</p>}
                    <p className="text-[11px] text-gray-400">{fmtDT(log.created_at || log.date)}</p>
                  </div>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* Items */}
      <section aria-label="Items in this order">
        <h2 className="font-bold text-deep-purple text-sm uppercase tracking-wider mb-3">Items ({order.items.length})</h2>
        <div className="space-y-3">
          {order.items.map((item) => (
            <div key={item.id} className="flex gap-4 items-center border border-gray-100 rounded-xl p-4 bg-white">
              <div className="relative w-16 h-16 bg-gray-50 rounded-lg border border-gray-100 shrink-0 overflow-hidden">
                <Image src={item.image} alt={item.name} fill className="object-contain p-1" sizes="64px" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-deep-purple truncate text-sm">{item.name}</h4>
                <p className="text-xs text-gray-500 mt-0.5">Qty {item.quantity} · ₹{item.price.toFixed(2)} each</p>
              </div>
              <p className="font-bold text-deep-purple text-sm whitespace-nowrap">₹{(item.price * item.quantity).toFixed(2)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Meta grid */}
      <section className="grid md:grid-cols-3 gap-4 text-xs">
        <div className="border border-gray-100 rounded-xl p-5 bg-white">
          <h3 className="font-bold text-deep-purple mb-2 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
            <MapPin size={13} className="text-gold" /> Delivery address
          </h3>
          <p className="font-semibold text-gray-800">{order.shippingAddress.fullName}</p>
          <p className="text-gray-600 mt-1 leading-relaxed">
            {order.shippingAddress.addressLine}
            <br />
            {order.shippingAddress.city}{order.shippingAddress.city && order.shippingAddress.state ? ", " : ""}{order.shippingAddress.state} — {order.shippingAddress.zipCode}
          </p>
          {order.shippingAddress.phone && <p className="text-gray-500 mt-1">Phone: {order.shippingAddress.phone}</p>}
        </div>
        <div className="border border-gray-100 rounded-xl p-5 bg-white">
          <h3 className="font-bold text-deep-purple mb-2 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
            <Wallet size={13} className="text-gold" /> Payment
          </h3>
          <p className="text-gray-600">Method: <span className="font-semibold text-gray-800">{order.paymentMethod}</span></p>
          {order.paymentStatus && <p className="text-gray-600 mt-1">Status: <span className="font-semibold text-gray-800 capitalize">{order.paymentStatus}</span></p>}
          <p className="text-gray-600 mt-1">Total: <span className="font-bold text-deep-purple">₹{(order.total || 0).toFixed(2)}</span></p>
        </div>
        <div className="border border-gray-100 rounded-xl p-5 bg-white print:hidden">
          <h3 className="font-bold text-deep-purple mb-2 uppercase tracking-wider text-[10px]">Next steps</h3>
          <div className="flex flex-col gap-2">
            {canReview && (
              <Link href={`/account/reviews?order=${encodeURIComponent(order.orderNumber)}`} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-deep-purple text-white hover:bg-deep-purple/90 rounded-lg text-xs font-bold transition-colors">
                <Star size={13} /> Review products
              </Link>
            )}
            {!canReview && (
              <p className="text-gray-500 leading-relaxed">Reviews unlock once this order is delivered.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
