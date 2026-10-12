"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";

export default function ProductGrid({ products }: { products: any[] }) {
  const { cart, addToCartGuarded, updateQuantity } = useCart();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const handleAddToCart = (product: { id: string; name: string; price: number; img: string; gst?: number }) => {
    // Already in the cart? Do nothing — the quantity stepper is showing instead.
    if (cart.some((item) => item.id === product.id)) return;
    addToCartGuarded(
      { id: product.id, name: product.name, price: product.price, image: product.img, gst: product.gst },
      isAuthenticated,
      () => {} // No login required to shop — the checkout form collects identity.
    );
  };

  // Buy Now: add qty 1 (never increment an existing line), then go straight
  // to checkout — the cart page no longer exists.
  const handleBuyNow = async (product: { id: string; name: string; price: number; img: string; gst?: number }) => {
    try {
      const alreadyInCart = cart.some((item) => item.id === product.id);
      if (!alreadyInCart) {
        await addToCartGuarded(
          { id: product.id, name: product.name, price: product.price, image: product.img, gst: product.gst },
          isAuthenticated,
          () => {}
        );
      }
    } finally {
      router.push("/checkout");
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8">
      {products.map((product) => (
        <div key={product.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all group flex flex-col relative">
          <Link href={`/products/${product.id}`} className="relative h-64 bg-[#f8f5f0] p-4 flex items-center justify-center block">
            <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-10">
              {(product.isBestSeller === true || product.isBestSeller === 'true') && (
                <div className="bg-rose-clay text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded shadow-sm">
                  Best Seller
                </div>
              )}
              {(product.isFeatured === true || product.isFeatured === 'true') && (
                <div className="bg-deep-purple text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded shadow-sm">
                  Featured
                </div>
              )}
              {(product.isTrending === true || product.isTrending === 'true') && (
                <div className="bg-sage text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded shadow-sm">
                  Trending
                </div>
              )}
              {(product.isRecommended === true || product.isRecommended === 'true') && (
                <div className="bg-gold text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded shadow-sm">
                  Recommended
                </div>
              )}
            </div>
            {product.originalPrice && product.originalPrice > product.price && (
              <div className="absolute top-3 right-3 bg-[#446f4b] text-white text-[10px] font-bold px-2.5 py-1 rounded-full z-10">
                {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF
              </div>
            )}
            <div className="relative w-full h-full transform group-hover:scale-105 transition-transform duration-500">
              <Image src={product.img} alt={product.name} fill sizes="(max-width: 768px) 100vw, 25vw" className="object-contain drop-shadow-md" />
            </div>
          </Link>
          
          <Link href={`/products/${product.id}`} className="px-5 pt-5 flex-1 flex flex-col justify-start bg-white text-center border-t border-gray-100 block">
            <div className="text-sm font-medium text-gold mb-1">{product.category}</div>
            <h3 className="text-lg font-playfair font-bold text-deep-purple mb-2 line-clamp-2">{product.name}</h3>
            <div className="flex items-center justify-center gap-2 mb-4">
              {product.originalPrice && (
                <span className="text-gray-400 line-through text-sm">₹{product.originalPrice.toFixed(2)}</span>
              )}
              <span className="text-rust font-bold text-lg">₹{product.price.toFixed(2)}</span>
            </div>
          </Link>

          <div className="px-5 pb-5 bg-white space-y-2">
            {(() => {
              const cartItem = cart.find(item => item.id === product.id);
              if (cartItem) {
                return (
                  <div className="flex items-center justify-between w-full h-[42px] border border-gold text-gold rounded font-medium overflow-hidden">
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); updateQuantity(product.id, cartItem.quantity - 1); }}
                      className="px-4 py-2 hover:bg-gold/10 hover:text-gold transition-colors flex items-center justify-center h-full min-w-[40px] text-lg font-bold"
                      aria-label={cartItem.quantity === 1 ? "Remove from cart" : "Decrease quantity"}
                    >
                      {cartItem.quantity === 1 ? <Trash2 size={16} className="text-rust" /> : "−"}
                    </button>
                    <span className="font-bold text-deep-purple px-2 select-none text-base">{cartItem.quantity}</span>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); updateQuantity(product.id, cartItem.quantity + 1); }}
                      className="px-4 py-2 hover:bg-gold/10 hover:text-gold transition-colors flex items-center justify-center h-full min-w-[40px] text-lg font-bold"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                );
              }
              return (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAddToCart(product); }}
                  className="w-full py-2 h-[42px] border border-gold text-gold rounded font-medium text-[11px] sm:text-xs hover:bg-gold hover:text-white transition-colors"
                >
                  Add to Cart
                </button>
              );
            })()}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleBuyNow(product); }}
              className="w-full h-[42px] bg-deep-purple text-white rounded font-bold text-[11px] sm:text-xs tracking-wide hover:bg-deep-purple/90 transition-colors"
            >
              Buy Now
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
