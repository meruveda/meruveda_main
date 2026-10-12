"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, ShoppingCart, Star, Trash2 } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useWishlist } from "@/context/WishlistContext";
import { ConfirmDialog, EmptyState, LoadingRow, Notice, SectionHeader } from "@/components/account/ui";

interface Enriched {
  id: string;
  name: string;
  price: number;
  mrp?: number;
  image: string;
  rating?: number;
  inStock: boolean;
}

/** Wishlist integrated with the existing WishlistContext (no duplicate
 *  system). Prices/ratings/stock are enriched from the product API so the
 *  cards show discount + stock status without extra backend work. */
export default function WishlistPage() {
  const { cart, addToCart } = useCart();
  const { wishlist, removeFromWishlist } = useWishlist();
  const router = useRouter();
  const [items, setItems] = useState<Enriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const enrich = async () => {
      setLoading(true);
      try {
        const { default: axiosInstance } = await import("@/api/axiosInstance");
        const out: Enriched[] = await Promise.all(
          wishlist.map(async (w) => {
            const base: Enriched = {
              id: w.id,
              name: w.name,
              price: w.price,
              image: w.image,
              inStock: true,
            };
            try {
              const res = await axiosInstance.get(`/products/${w.id}`);
              const p = res.data?.data || res.data;
              if (p) {
                base.price = Number(p.selling_price ?? p.price ?? w.price);
                base.mrp = p.mrp ? Number(p.mrp) : p.compare_at_price ? Number(p.compare_at_price) : undefined;
                base.rating = p.average_rating ? Number(p.average_rating) : p.rating ? Number(p.rating) : undefined;
                base.image = p.images?.[0]?.url || p.images?.[0] || w.image;
                base.inStock = (p.stock_quantity ?? p.stock ?? 1) > 0;
              }
            } catch {
              /* keep context snapshot */
            }
            return base;
          }),
        );
        setItems(out);
      } finally {
        setLoading(false);
      }
    };
    enrich();
  }, [wishlist]);

  const addToCartGo = (item: Enriched, buyNow = false) => {
    if (!cart.some((e) => e.id === item.id)) {
      addToCart({ id: item.id, name: item.name, price: item.price, image: item.image });
    }
    if (buyNow) {
      router.push("/checkout");
    } else {
      setNotice(`“${item.name}” moved to cart.`);
      setTimeout(() => setNotice(null), 2500);
    }
  };

  const confirmRemove = async () => {
    if (!removeId) return;
    await removeFromWishlist(removeId);
    setRemoveId(null);
  };

  if (loading) return <LoadingRow label="Loading your wishlist…" />;

  return (
    <div>
      <SectionHeader title="My Wishlist" subtitle={`${items.length} saved item${items.length === 1 ? "" : "s"} — prices refresh automatically.`} />

      {notice && <Notice>{notice}</Notice>}

      {items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Your wishlist is empty"
          message="Tap the heart on any product to save it here, then move it to cart when you are ready."
          ctaLabel="Discover Products"
          ctaHref="/products"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {items.map((item) => {
            const discount = item.mrp && item.mrp > item.price
              ? Math.round(((item.mrp - item.price) / item.mrp) * 100)
              : 0;
            return (
              <div key={item.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col">
                <Link href={`/products/${item.id}`} className="relative aspect-square w-full bg-[#f8f5f0] block">
                  <Image src={item.image} alt={item.name} fill className="object-contain p-5" sizes="300px" />
                  {discount > 0 && (
                    <span className="absolute top-3 left-3 bg-green-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                      {discount}% OFF
                    </span>
                  )}
                  {!item.inStock && (
                    <span className="absolute top-3 right-3 bg-gray-800 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                      Out of stock
                    </span>
                  )}
                </Link>
                <div className="p-4 flex-1 flex flex-col border-t border-gray-50">
                  <Link href={`/products/${item.id}`} className="font-playfair font-bold text-deep-purple text-[15px] leading-snug hover:text-gold line-clamp-2">
                    {item.name}
                  </Link>
                  {typeof item.rating === "number" && (
                    <p className="flex items-center gap-1 text-xs text-gray-500 mt-1.5">
                      <Star size={13} className="text-gold fill-gold" />
                      <span className="font-bold text-deep-purple">{item.rating.toFixed(1)}</span> rated
                    </p>
                  )}
                  <p className="mt-1.5 flex items-baseline gap-2">
                    <span className="font-bold text-deep-purple">₹{item.price.toFixed(2)}</span>
                    {item.mrp && item.mrp > item.price && (
                      <span className="text-xs text-gray-400 line-through">₹{item.mrp.toFixed(2)}</span>
                    )}
                  </p>
                  <p className={`text-[11px] font-bold mt-1 ${item.inStock ? "text-green-600" : "text-red-500"}`}>
                    {item.inStock ? "In stock" : "Currently unavailable"}
                  </p>
                  <div className="mt-3.5 space-y-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => addToCartGo(item)}
                        disabled={!item.inStock}
                        className="flex-1 border border-gold text-gold hover:bg-gold hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gold py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <ShoppingCart size={13} /> Add to Cart
                      </button>
                      <button
                        onClick={() => setRemoveId(item.id)}
                        className="p-2 border border-gray-200 hover:bg-red-50 hover:text-red-500 rounded-lg text-gray-400 transition-colors"
                        aria-label={`Remove ${item.name} from wishlist`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <button
                      onClick={() => addToCartGo(item, true)}
                      disabled={!item.inStock}
                      className="w-full bg-deep-purple text-white hover:bg-deep-purple/90 disabled:opacity-40 py-2 rounded-lg text-xs font-bold transition-colors"
                    >
                      Buy Now
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={removeId !== null}
        title="Remove from wishlist?"
        message="You can save it again anytime from the product page."
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onClose={() => setRemoveId(null)}
      />
    </div>
  );
}
