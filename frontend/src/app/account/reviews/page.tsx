"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Pencil, Star, Trash2 } from "lucide-react";
import { reviewService } from "@/services/accountService";
import type { AccountReview } from "@/types/account";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  LoadingRow,
  Notice,
  SectionHeader,
  Stars,
} from "@/components/account/ui";

interface Eligible {
  productId: string;
  name: string;
  image: string;
  orderNumber: string;
}

function ReviewsInner() {
  const search = useSearchParams();
  const focusOrder = search.get("order") || "";
  const [reviews, setReviews] = useState<AccountReview[]>([]);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Composer state
  const [showForm, setShowForm] = useState(false);
  const [productId, setProductId] = useState("");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, elig] = await Promise.all([
        reviewService.mine().catch(() => [] as AccountReview[]),
        reviewService.eligibleProducts().catch(() => [] as Eligible[]),
      ]);
      setReviews(mine);
      setEligible(elig);
      if (focusOrder && elig.length > 0 && !productId) {
        const match = elig.find((e) => e.orderNumber === focusOrder);
        if (match) {
          setProductId(match.productId);
          setShowForm(true);
        }
      }
    } catch (e) {
      setError((e as Error)?.message || "Could not load reviews.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reviewedIds = new Set(reviews.map((r) => r.productId));
  const pending = eligible.filter((e) => !reviewedIds.has(e.productId));

  const openNew = (pid = "") => {
    setEditingId(null);
    setProductId(pid || pending[0]?.productId || eligible[0]?.productId || "");
    setRating(5);
    setText("");
    setPhotoUrl("");
    setShowForm(true);
  };

  const openEdit = (r: AccountReview) => {
    setEditingId(r.id);
    setProductId(r.productId);
    setRating(r.rating);
    setText(r.text);
    setPhotoUrl(r.images?.[0] || "");
    setShowForm(true);
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!productId) return;
    if (rating < 1 || rating > 5) return;
    if (text.trim().length < 3) {
      setNotice("Please write a few words about the product.");
      setTimeout(() => setNotice(null), 3000);
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await reviewService.update(editingId, rating, text.trim());
        setNotice("Review updated.");
      } else {
        await reviewService.create(productId, rating, text.trim(), photoUrl.trim() ? [photoUrl.trim()] : []);
        setNotice("Thanks! Your review was submitted.");
      }
      setShowForm(false);
      setEditingId(null);
      await load();
      setTimeout(() => setNotice(null), 3500);
    } catch (e) {
      setNotice((e as Error)?.message || "Could not save your review.");
      setTimeout(() => setNotice(null), 3500);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await reviewService.remove(deleteId);
      setReviews((prev) => prev.filter((r) => r.id !== deleteId));
      setNotice("Review deleted.");
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      setNotice((e as Error)?.message || "Could not delete your review.");
      setTimeout(() => setNotice(null), 3000);
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  if (loading) return <LoadingRow label="Loading your feedback…" />;

  return (
    <div>
      <SectionHeader
        title="Reviews & Feedback"
        subtitle="Only products you have received can be reviewed. Your ratings help other shoppers."
        action={
          pending.length > 0 && !showForm ? (
            <button onClick={() => openNew()} className="bg-deep-purple text-white hover:bg-deep-purple/90 px-4 py-2.5 rounded-lg text-xs font-bold whitespace-nowrap">
              Write a Review ({pending.length} pending)
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-6">
          <ErrorBox message={error} onRetry={load} />
        </div>
      )}
      {notice && <Notice tone={notice.startsWith("Thanks") || notice.includes("updated") || notice.includes("deleted") ? "success" : "error"}>{notice}</Notice>}

      {pending.length > 0 && (
        <div className="mb-7">
          <h3 className="font-bold text-deep-purple text-xs uppercase tracking-wider mb-3">Awaiting your review ({pending.length})</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {pending.slice(0, 4).map((p) => (
              <div key={p.productId} className="flex items-center gap-3 border border-gold/30 bg-gold/5 rounded-xl p-3.5">
                <div className="relative w-12 h-12 bg-white rounded-lg border border-gray-100 shrink-0 overflow-hidden">
                  <Image src={p.image} alt={p.name} fill className="object-contain p-1" sizes="48px" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-deep-purple text-xs truncate">{p.name}</p>
                  <p className="text-[11px] text-gray-500">Order {p.orderNumber}</p>
                </div>
                <button onClick={() => openNew(p.productId)} className="px-3.5 py-2 bg-deep-purple text-white rounded-lg text-[11px] font-bold whitespace-nowrap">
                  Review
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} noValidate className="bg-gray-50/50 p-5 md:p-6 rounded-2xl border border-gray-100 mb-8 space-y-4 max-w-2xl">
          <h3 className="font-playfair font-bold text-deep-purple text-lg">{editingId ? "Edit your review" : "Write a review"}</h3>
          {!editingId && (
            <div>
              <label className="block text-gray-700 font-medium mb-1.5 text-xs" htmlFor="rv-product">Product *</label>
              <select
                id="rv-product"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gold"
              >
                {eligible.length === 0 && <option value="">No purchased products yet</option>}
                {eligible.map((e) => (
                  <option key={e.productId} value={e.productId}>{e.name} — order {e.orderNumber}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <span className="block text-gray-700 font-medium mb-1.5 text-xs">Your rating *</span>
            <Stars value={rating} onChange={setRating} />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1.5 text-xs" htmlFor="rv-text">Review *</label>
            <textarea id="rv-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="How did the product work for you?" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gold" />
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1.5 text-xs" htmlFor="rv-photo">Photo <span className="text-gray-400 font-normal">(optional URL)</span></label>
            <input id="rv-photo" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" inputMode="url" className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gold" />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-5 py-2.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2.5 bg-deep-purple text-white rounded-lg text-xs font-bold disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />} {editingId ? "Save Changes" : "Submit Review"}
            </button>
          </div>
        </form>
      )}

      {reviews.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No reviews yet"
          message={eligible.length > 0 ? "You have delivered products waiting for a review — share your experience above." : "Reviews appear here after you rate a product you received."}
          ctaLabel="Browse Products"
          ctaHref="/products"
        />
      ) : (
        <div className="space-y-4">
          <h3 className="font-bold text-deep-purple text-xs uppercase tracking-wider">Your reviews ({reviews.length})</h3>
          {reviews.map((r) => (
            <div key={r.id} className="border border-gray-100 rounded-2xl p-5 bg-white">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Link href={`/products/${r.productId}`} className="font-bold text-deep-purple hover:text-gold transition-colors text-sm">
                  {r.productName}
                </Link>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-deep-purple rounded" aria-label="Edit review">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => setDeleteId(r.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded" aria-label="Delete review">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="mt-2">
                <Stars value={r.rating} readonly size={16} />
              </div>
              {r.text && <p className="text-sm text-gray-600 italic mt-2 leading-relaxed">“{r.text}”</p>}
              {r.images && r.images.length > 0 && (
                <div className="flex gap-2 mt-3">
                  {r.images.slice(0, 3).map((src, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-100 bg-gray-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Review photo ${i + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-2">
                {new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                {r.status ? ` · ${r.status}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete this review?"
        message="Your rating and photos will be removed permanently."
        confirmLabel="Delete Review"
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
}

export default function MyReviewsPage() {
  return (
    <Suspense fallback={<LoadingRow label="Loading your feedback…" />}>
      <ReviewsInner />
    </Suspense>
  );
}
