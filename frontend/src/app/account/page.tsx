"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { orderService, reviewService } from "@/services/accountService";
import type { AccountOrder } from "@/types/account";
import { DashboardCards, ProfileHeaderCard, QuickLinks, RecentOrders, type OverviewData } from "@/components/account/Overview";
import { EditProfileModal } from "@/components/account/EditProfileModal";
import { ErrorBox, SectionHeader, SkeletonCard } from "@/components/account/ui";

export default function AccountOverviewPage() {
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewData>({ orders: [], reviewCount: 0, pendingReviews: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orders, myReviews] = await Promise.all([
        orderService.myOrders().catch(() => [] as AccountOrder[]),
        reviewService.mine().catch(() => []),
      ]);
      const deliveredItems = new Set<string>();
      for (const o of orders) {
        if (o.normalizedStatus !== "delivered") continue;
        for (const it of o.items) deliveredItems.add(it.productId);
      }
      const reviewedIds = new Set(myReviews.map((r) => r.productId));
      let pending = 0;
      deliveredItems.forEach((id) => {
        if (!reviewedIds.has(id)) pending += 1;
      });
      setData({ orders, reviewCount: myReviews.length, pendingReviews: pending });
    } catch (e) {
      setError((e as Error)?.message || "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="My Account"
        subtitle="Orders, reviews and settings — everything in one place."
        action={
          <Link href="/account/track" className="text-xs font-bold text-gold hover:underline whitespace-nowrap">
            Track a package →
          </Link>
        }
      />

      <ProfileHeaderCard onEdit={() => setEditOpen(true)} />

      {error && <ErrorBox message={error} onRetry={load} />}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : (
        <DashboardCards data={data} loading={false} />
      )}

      <div className="bg-ivory/40 border border-gray-100 rounded-2xl p-5 md:p-6">
        <h3 className="font-playfair font-bold text-deep-purple text-lg mb-4">Recent orders</h3>
        {loading ? (
          <div className="space-y-3">
            <SkeletonCard lines={2} />
          </div>
        ) : (
          <RecentOrders orders={data.orders} loading={false} />
        )}
      </div>

      <QuickLinks />

      <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}
