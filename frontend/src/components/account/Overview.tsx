"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Heart,
  MapPin,
  Package,
  Pencil,
  ShieldCheck,
  Star,
  Truck,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useWishlist } from "@/context/WishlistContext";
import type { AccountOrder } from "@/types/account";
import { memberSinceLabel } from "@/types/account";
import { displayEmail, normalizePhone10 } from "@/types/account";
import { EmptyState, StatusBadge } from "./ui";

/* Profile header card — avatar, name, contact, member-since + Edit action. */
export function ProfileHeaderCard({ onEdit }: { onEdit: () => void }) {
  const { user } = useAuth();
  if (!user) return null;
  const createdRaw = (user as unknown as Record<string, unknown>).created_at as string | undefined;
  const since = memberSinceLabel(createdRaw);
  return (
    <section className="bg-white p-6 md:p-7 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-5 flex-wrap" aria-label="Profile summary">
      {user.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar} alt={`${user.firstName} ${user.lastName}`} className="w-20 h-20 rounded-full object-cover border-2 border-gold/40" />
      ) : (
        <div className="w-20 h-20 rounded-full bg-gold flex items-center justify-center text-deep-purple text-2xl font-bold shrink-0" aria-hidden>
          {(user.firstName?.[0] || "U").toUpperCase()}{(user.lastName?.[0] || "").toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-[200px]">
        <h2 className="text-2xl font-playfair font-bold text-deep-purple leading-tight">
          {user.firstName} {user.lastName}
        </h2>
        <p className="text-sm text-gray-500 truncate mt-0.5">{displayEmail(user.email) || "No email on file"}</p>
        {user.phone && <p className="text-sm text-gray-500">+91 {normalizePhone10(user.phone)}</p>}
        <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1.5">
          <ShieldCheck size={13} className="text-sage" />
          {since ? `Member since ${since}` : "Verified MeruVeda customer"}
        </p>
      </div>
      <button
        onClick={onEdit}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold bg-deep-purple text-white hover:bg-deep-purple/90 transition-colors"
      >
        <Pencil size={15} /> Edit Profile
      </button>
    </section>
  );
}

export interface OverviewData {
  orders: AccountOrder[];
  reviewCount: number;
  pendingReviews: number;
}

/* Clickable quick-access stat cards. */
export function DashboardCards({ data, loading }: { data: OverviewData; loading: boolean }) {
  const { wishlist } = useWishlist();
  const cards = useMemo(
    () => [
      {
        name: "My Orders",
        href: "/account/orders",
        icon: Package,
        total: data.orders.length,
        sub: `${data.orders.filter((o) => !["delivered", "cancelled", "failed"].includes(o.normalizedStatus)).length} active`,
      },
      {
        name: "Reviews",
        href: "/account/reviews",
        icon: Star,
        total: data.reviewCount,
        sub: `${data.pendingReviews} pending`,
      },
      {
        name: "Wishlist",
        href: "/account/wishlist",
        icon: Heart,
        total: wishlist.length,
        sub: "saved items",
      },
    ],
    [data, wishlist.length],
  );
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Account summary">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link
            key={c.href}
            href={c.href}
            className="bg-white hover:border-gold/50 hover:shadow-md border border-gray-100 rounded-2xl p-4 md:p-5 transition-all group shadow-sm"
          >
            <Icon size={19} className="text-gold mb-2.5 group-hover:scale-110 transition-transform" />
            <p className="text-2xl font-playfair font-bold text-deep-purple">{loading ? "–" : c.total}</p>
            <p className="text-xs font-bold text-deep-purple mt-0.5">{c.name}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{loading ? "Loading…" : c.sub}</p>
          </Link>
        );
      })}
    </div>
  );
}

/* Recent orders preview used on the Overview tab. */
export function RecentOrders({ orders, loading }: { orders: AccountOrder[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-gray-400 py-6 text-center">Loading recent orders…</p>;
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No orders yet"
        message="Start shopping to see your orders here."
        ctaLabel="Start Shopping"
        ctaHref="/products"
      />
    );
  }
  return (
    <div className="space-y-3">
      {orders.slice(0, 3).map((o) => (
        <Link
          key={o.id}
          href={`/account/orders/${encodeURIComponent(o.id)}`}
          className="flex items-center gap-4 border border-gray-100 rounded-xl px-4 py-3.5 bg-white hover:border-gold/40 hover:shadow-sm transition-all"
        >
          <div className="flex-1 min-w-0">
            <p className="font-bold text-deep-purple text-sm truncate">{o.orderNumber}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {new Date(o.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
              {o.items.length} item{o.items.length === 1 ? "" : "s"} · ₹{(o.total || 0).toFixed(2)}
            </p>
          </div>
          <StatusBadge status={o.status} />
        </Link>
      ))}
      <Link href="/account/orders" className="inline-block text-xs font-bold text-gold hover:underline mt-1">
        View all orders →
      </Link>
    </div>
  );
}

/* Small cross-links so Track / Addresses / Settings stay discoverable. */
export function QuickLinks() {
  const links = [
    { href: "/account/track", icon: Truck, label: "Track Orders", blurb: "Live courier status" },
    { href: "/account/addresses", icon: MapPin, label: "Addresses", blurb: "Delivery book" },
    { href: "/account/settings", icon: ShieldCheck, label: "Settings", blurb: "Security & alerts" },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3.5 hover:border-gold/40 transition-all"
          >
            <span className="w-9 h-9 rounded-full bg-ivory flex items-center justify-center shrink-0">
              <Icon size={17} className="text-gold" />
            </span>
            <span>
              <span className="block text-sm font-bold text-deep-purple">{l.label}</span>
              <span className="block text-[11px] text-gray-500">{l.blurb}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
