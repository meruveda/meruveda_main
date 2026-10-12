"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, Package, Search, Truck } from "lucide-react";
import { orderService } from "@/services/accountService";
import type { AccountOrder } from "@/types/account";
import { EmptyState, ErrorBox, SectionHeader, SkeletonCard, StatusBadge } from "@/components/account/ui";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

const TERMINAL_BAD = ["cancelled", "failed", "returned", "refunded"];
const TERMINAL_GOOD = ["delivered", ...TERMINAL_BAD];
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await orderService.myOrders());
    } catch (e) {
      setError((e as Error)?.message || "Could not load your orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      // Admin-set post-delivery states (returned/refunded) are terminal, not active.
      if (filter === "active" && TERMINAL_GOOD.includes(o.normalizedStatus)) return false;
      if (filter === "delivered" && o.normalizedStatus !== "delivered") return false;
      if (filter === "cancelled" && !TERMINAL_BAD.includes(o.normalizedStatus)) return false;
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q))
      );
    });
  }, [orders, filter, query]);

  const invoice = (order: AccountOrder) => {
    // Fixed GST invoice PDF download (backend template). Anchor download is
    // popup-blocker safe; the printable detail view is the fallback.
    import("@/api/axiosInstance").then(async ({ default: axiosInstance }) => {
      try {
        const res = await axiosInstance.get(`/orders/${order.id}/invoice`, { responseType: "blob" });
        const blob = new Blob([res.data], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = url;
          a.download = `Invoice-${order.orderNumber || order.id}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } catch {
        // Fallback to printable detail view.
        router.push(`/account/orders/${encodeURIComponent(order.id)}?print=1`);
      }
    });
  };

  return (
    <div>
      <SectionHeader
        title="My Orders"
        subtitle="Track shipments, view invoices or buy again."
      />

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <label className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by order ID or product…"
            className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-gold focus:ring-1 focus:ring-gold/30"
            aria-label="Search orders"
          />
        </label>
        <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Order filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                filter === f.key ? "bg-deep-purple text-white" : "bg-ivory text-gray-600 hover:bg-gray-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      ) : error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No orders yet"
          message="Start shopping to see your orders here."
          ctaLabel="Start Shopping"
          ctaHref="/products"
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching orders"
          message="Try a different search or filter."
        />
      ) : (
        <div className="space-y-4">
          {visible.map((order) => (
            <article key={order.id} className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm bg-white">
              <div className="bg-gray-50/70 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100">
                <div className="flex gap-6 sm:gap-8 text-xs text-gray-500">
                  <div>
                    <p className="font-semibold uppercase tracking-wider mb-0.5 text-[10px]">Order placed</p>
                    <p className="font-medium text-gray-800">{fmtDate(order.date)}</p>
                  </div>
                  <div>
                    <p className="font-semibold uppercase tracking-wider mb-0.5 text-[10px]">Total</p>
                    <p className="font-medium text-gray-800">₹{(order.total || 0).toFixed(2)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold uppercase tracking-wider mb-0.5 text-[10px]">Order #</p>
                    <p className="font-medium text-gray-800 truncate max-w-[140px] sm:max-w-none">{order.orderNumber}</p>
                  </div>
                </div>
                <StatusBadge status={order.status} />
              </div>

              <div className="p-5">
                <div className="space-y-3.5">
                  {order.items.slice(0, 3).map((item) => (
                    <div key={item.id} className="flex gap-3.5 items-center min-w-0">
                      <div className="relative w-14 h-14 bg-gray-50 rounded-lg border border-gray-100 shrink-0 overflow-hidden">
                        <Image src={item.image} alt={item.name} fill className="object-contain p-1" sizes="56px" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-deep-purple truncate text-sm">{item.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">Qty {item.quantity} · ₹{item.price.toFixed(2)} each</p>
                      </div>
                      <p className="font-semibold text-deep-purple text-sm whitespace-nowrap">₹{(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                  ))}
                  {order.items.length > 3 && (
                    <p className="text-xs text-gray-400">+ {order.items.length - 3} more item(s)</p>
                  )}
                </div>

                <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between flex-wrap gap-3">
                  <p className="text-xs text-gray-500">
                    {order.normalizedStatus === "delivered" ? "Delivered" : "Arriving by"}{" "}
                    <span className="font-semibold text-deep-purple">
                      {order.estimatedDelivery
                        ? fmtDate(order.estimatedDelivery)
                        : fmtDate(order.date)}
                    </span>
                    <span className="block mt-0.5 text-[11px] text-gray-400">
                      {order.paymentMethod} · {order.shippingAddress.city}
                      {order.shippingAddress.city && order.shippingAddress.state ? ", " : ""}{order.shippingAddress.state}
                    </span>
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {(order.trackingUrl || order.trackingNumber) && (
                      <Link
                        href={`/account/orders/${encodeURIComponent(order.id)}`}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-gold/15 text-gold border border-gold/30 hover:bg-gold hover:text-deep-purple rounded-lg text-xs font-bold transition-colors"
                      >
                        <Truck size={14} /> Track Order
                      </Link>
                    )}
                    <button
                      onClick={() => invoice(order)}
                      className="flex items-center gap-1.5 px-3.5 py-2 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-semibold text-gray-700 transition-colors"
                    >
                      <Download size={14} /> Invoice
                    </button>
                    <Link
                      href={`/account/orders/${encodeURIComponent(order.id)}`}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-deep-purple text-white hover:bg-deep-purple/90 rounded-lg text-xs font-bold transition-colors"
                    >
                      <Eye size={14} /> View Details
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
