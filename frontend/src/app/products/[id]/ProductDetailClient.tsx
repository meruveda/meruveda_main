"use client";

import React, { useMemo, useState } from 'react';
import {
  reviewsForProduct,
  sortReviews,
  summarize,
  type Review,
  type ReviewSort,
} from '@/data/reviews';
import MediaImage from "@/components/MediaImage";
import { useRouter } from 'next/navigation';
import { Minus, Plus, ShoppingCart, Sparkles, Droplets, Star, Loader2, ArrowRight, BadgeCheck } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { track } from '@/lib/analytics';
import { getImageUrls } from '@/lib/productImage';
import { motion, AnimatePresence } from 'framer-motion';

/** One approved review as GET /api/reviews returns it. */
interface ProductReviewApi {
  id: string;
  rating?: number | string | null;
  comment?: string | null;
  title?: string | null;
  created_at?: string | null;
  users?: { first_name?: string | null; last_name?: string | null } | null;
}

/** Map an API row onto the display shape the review wall already renders. */
function toDisplayReview(review: ProductReviewApi, productId: string): Review {
  const stars = Math.min(5, Math.max(1, Math.round(Number(review.rating) || 0)));
  return {
    id: review.id,
    productId,
    name:
      [review.users?.first_name, review.users?.last_name].filter(Boolean).join(' ').trim() ||
      'Customer',
    rating: stars as Review['rating'],
    title: review.title || undefined,
    text: review.comment || '',
    date: String(review.created_at || '').slice(0, 10),
  };
}

export default function ProductDetailClient({
  product,
  reviews: apiReviews,
}: {
  product: any;
  /** Approved reviews from GET /api/reviews (server-fetched; may be []). */
  reviews?: ProductReviewApi[];
}) {
  const { addToCartGuarded, cart, updateQuantity } = useCart();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  // The MAIN image is the first one the catalogue stores; it can be a plain
  // url or a {id,url,alt} entry, so it is read through the shared helper.
  const galleryImages = getImageUrls(product.images);
  const [mainImage, setMainImage] = useState(
    galleryImages[0] || product.thumbnail || '/images/placeholder.jpg'
  );
  
  const [localQuantity, setLocalQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState('description');

  // view_item — fires once per product mount. GA4/Meta only receive this if the
  // visitor accepted analytics; our own first-party event always records it.
  React.useEffect(() => {
    if (!product?.id) return;
    track('view_item', {
      items: [{
        item_id: product.id,
        item_name: product.name,
        price: Number(product.price) || 0,
      }],
    });
  }, [product?.id]);

  /**
 * Reviews come from the database (GET /api/reviews, approved only) and are
 * server-fetched with the page, so the wall, the average and the count always
 * reflect what the admin has approved. The curated static list in
 * src/data/reviews.ts remains the fallback when the API is unreachable.
 */
const [sort, setSort] = useState<ReviewSort>('newest');

  const reviewSource = useMemo(() => {
    const fromApi = (apiReviews ?? [])
      .map((review) => toDisplayReview(review, product.slug || product.id || 'all'))
      .filter((review) => review.rating > 0);
    if (fromApi.length > 0) return fromApi;
    return reviewsForProduct(product.slug || product.name || '');
  }, [apiReviews, product.slug, product.id, product.name]);

  const reviews = useMemo(() => sortReviews(reviewSource, sort), [reviewSource, sort]);

const ratingSummary = useMemo(() => summarize(reviewSource), [reviewSource]);


  const cartItem = cart.find((item: any) => item.id === product.id);

  const price = product.sellingPrice !== undefined && product.sellingPrice !== null && product.sellingPrice < product.price
    ? product.sellingPrice
    : product.price;
  const originalPrice = product.sellingPrice !== undefined && product.sellingPrice !== null && product.sellingPrice < product.price
    ? product.price
    : null;
  const discount = originalPrice ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0;

  const benefits = product.seoMetadata?.benefits || product.seo_metadata?.benefits;
  const benefitsList = Array.isArray(benefits)
    ? benefits
    : typeof benefits === 'string'
      ? benefits.split(',').map((b: string) => b.trim()).filter(Boolean)
      : [];

  const handleAddToCart = () => {
    addToCartGuarded(
      { 
        id: product.id, 
        name: product.name, 
        price: price, 
        image: mainImage,
        quantity: localQuantity,
        gst: product.gst !== undefined 
          ? product.gst 
          : (product.seoMetadata?.gst !== undefined ? product.seoMetadata.gst : 18)
      },
      isAuthenticated,
      () => router.push(`/login?returnUrl=/products/${product.id}`)
    );
  };

  const stockLabels: Record<string, {text: string, color: string}> = {
    'in_stock': { text: 'In Stock', color: 'text-emerald-400' },
    'out_of_stock': { text: 'Out of Stock', color: 'text-rose-400' },
    'low_stock': { text: 'Low Stock', color: 'text-amber-400' },
  };
  const stockInfo = stockLabels[product.stockStatus || 'in_stock'] || stockLabels['in_stock'];

  return (
    <div className="relative min-h-screen bg-bg-ivory text-plum-deep font-sans selection:bg-gold-antique selection:text-white pt-10 pb-20 overflow-hidden">
      
      {/* Signature Botanical Watermark */}
      <div className="absolute top-20 right-0 pointer-events-none opacity-[0.03] text-sage -z-10 rotate-12">
        <svg width="400" height="400" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M100 180C100 180 50 140 50 90C50 40 90 20 100 20C110 20 150 40 150 90C150 140 100 180 100 180Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M100 20V180" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M100 100C100 100 130 80 140 60" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M100 130C100 130 70 110 60 90" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M90 180C70 190 40 180 30 160C20 140 40 120 50 120C60 120 70 140 90 150" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <div className="container relative z-10 mx-auto px-6 py-8 md:py-16 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          
          {/* Left: Image Gallery */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="flex flex-col gap-4"
          >
            <div className="relative aspect-[4/5] w-full rounded-2xl p-8 flex items-center justify-center overflow-hidden bg-stone-100 group">
              <motion.div 
                key={mainImage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="relative w-full h-full z-0"
              >
                <MediaImage 
                  src={mainImage} 
                  alt={product.name} 
                  fill 
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-contain" 
                  priority
                />
              </motion.div>
            </div>
            
            {/* Thumbnails */}
            {galleryImages.length > 1 && (
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                {galleryImages.map((url: string, idx: number) => (
                  <button
                    key={`${url}-${idx}`}
                    onClick={() => setMainImage(url)}
                    className={`relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 transition-all border ${mainImage === url ? 'border-gold-antique' : 'border-transparent bg-stone-100 hover:border-gold-antique/50'}`}
                  >
                    <div className="absolute inset-0 p-2">
                      <MediaImage src={url} alt={`${product.name} thumbnail ${idx + 1}`} fill sizes="80px" className="object-contain" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </motion.div>

          {/* Right: Product Details */}
          <div className="flex flex-col">
            
            {/* Eyebrow Pill */}
            <div className="flex flex-wrap gap-2 mb-6 items-center">
              <motion.div 
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="inline-flex items-center gap-2 border border-sage/40 px-3 py-1 rounded-full w-max"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-gold-antique" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sage">{product.categoryName || 'Wellness'}</span>
              </motion.div>
              {(product.isBestSeller === true || product.isBestSeller === 'true' || product.seoMetadata?.isBestSeller === true || product.seoMetadata?.isBestSeller === 'true') && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.05 }}
                  className="bg-rose-clay text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] shadow-sm"
                >
                  Best Seller
                </motion.div>
              )}
              {(product.isFeatured === true || product.isFeatured === 'true' || product.seoMetadata?.isFeatured === true || product.seoMetadata?.isFeatured === 'true') && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                  className="bg-deep-purple text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] shadow-sm"
                >
                  Featured
                </motion.div>
              )}
              {(product.isTrending === true || product.isTrending === 'true' || product.seoMetadata?.isTrending === true || product.seoMetadata?.isTrending === 'true') && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
                  className="bg-sage text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] shadow-sm"
                >
                  Trending
                </motion.div>
              )}
              {(product.isRecommended === true || product.isRecommended === 'true' || product.seoMetadata?.isRecommended === true || product.seoMetadata?.isRecommended === 'true') && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
                  className="bg-gold text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] shadow-sm"
                >
                  Recommended
                </motion.div>
              )}
            </div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut", delay: 0.08 }}
              className="text-4xl md:text-5xl lg:text-6xl font-fraunces font-medium text-plum-deep mb-4 leading-[1.1] tracking-tight"
            >
              {product.name}
            </motion.h1>

            <motion.div 
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut", delay: 0.16 }}
              className="flex items-center gap-4 mb-8"
            >
              <span className="text-3xl md:text-4xl font-ibm-plex-mono font-medium text-plum-deep">₹{price.toFixed(2)}</span>
              {originalPrice && (
                <>
                  <span className="text-lg md:text-xl text-gray-400 line-through font-ibm-plex-mono">₹{originalPrice.toFixed(2)}</span>
                  <span className="bg-rose-clay text-white px-2 py-1 text-[11px] font-bold uppercase rounded tracking-wider shadow-sm">Save {discount}%</span>
                </>
              )}
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.24 }}
              className="mb-10 flex items-center gap-2"
            >
              <div className={`w-2 h-2 rounded-full ${product.stockStatus === 'out_of_stock' ? 'bg-rose-clay' : 'bg-sage'}`} />
              <span className={`text-[12px] font-semibold uppercase tracking-[0.08em] ${product.stockStatus === 'out_of_stock' ? 'text-rose-clay' : 'text-sage'}`}>
                {product.stockStatus === 'out_of_stock' ? 'Out of Stock' : 'In Stock'}
              </span>
            </motion.div>

            {/* Benefits list */}
            {benefitsList.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.28 }}
                className="mb-8 p-5 bg-gold-antique/5 rounded-2xl border border-gold-antique/15 space-y-2.5"
              >
                <div className="flex items-center gap-1.5 text-gold-antique font-bold text-xs uppercase tracking-wider">
                  <Sparkles size={14} className="text-gold-antique" /> Key Benefits
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm text-plum-deep/85">
                  {benefitsList.map((benefit: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-gold-antique mt-0.5">•</span>
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}

            {/* Interactive Tabs */}
            <motion.div 
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.32 }}
              className="mb-10 min-h-[240px]"
            >
              <div className="flex gap-8 border-b border-stone-100 mb-8 relative">
                {['description', 'details'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`pb-4 text-[15px] font-semibold uppercase tracking-wider transition-colors relative ${activeTab === tab ? 'text-plum-deep' : 'text-gray-400 hover:text-plum-deep/70'}`}
                  >
                    {tab}
                    {activeTab === tab && (
                      <motion.div 
                        layoutId="activeTabUnderline"
                        className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-plum-deep"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {activeTab === 'description' && (
                  <motion.div
                    key="desc"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="prose prose-p:text-plum-deep/80 prose-p:leading-relaxed prose-p:text-[16px] max-w-none marker:text-gold-antique"
                  >
                    {product.description && product.description.length > 20 && product.description !== 'Relief' ? (
                      <div className="product-description-content text-plum-deep/85 space-y-4">
                        <style>{`
                          .product-description-content ul {
                            list-style-type: disc !important;
                            padding-left: 1.5rem !important;
                            margin-top: 0.75rem !important;
                            margin-bottom: 0.75rem !important;
                          }
                          .product-description-content ol {
                            list-style-type: decimal !important;
                            padding-left: 1.5rem !important;
                            margin-top: 0.75rem !important;
                            margin-bottom: 0.75rem !important;
                          }
                          .product-description-content li {
                            margin-bottom: 0.35rem !important;
                            list-style: inherit !important;
                          }
                          .product-description-content p {
                            margin-bottom: 0.75rem !important;
                            line-height: 1.6 !important;
                          }
                        `}</style>
                        <div dangerouslySetInnerHTML={{ __html: product.description }} />
                      </div>
                    ) : (
                      <p>
                        A potent botanical blend crafted to restore balance and vitality. Harnessing the restorative properties of organically sourced herbs, this formulation is designed to support natural healing, improve daily wellness, and harmonize your body's intrinsic rhythms according to authentic Ayurvedic principles.
                      </p>
                    )}

                    {/* Shop Now — jumps to the buy section for this product */}
                    <div className="pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          document.getElementById("buy")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                        className="inline-flex items-center gap-2 bg-gold-antique hover:bg-[#A37E33] text-white px-7 py-3 rounded-lg font-semibold text-sm tracking-wide transition-colors shadow-sm hover:shadow-[0_4px_14px_rgba(176,138,62,0.3)]"
                      >
                        Shop Now
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </motion.div>
                )}
                {activeTab === 'details' && (
                  <motion.div
                    key="details"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex flex-col border border-stone-200/50 rounded-xl divide-y divide-stone-100 bg-stone-50/20"
                  >
                    {[
                      { label: 'Brand', value: product.brand },
                      { label: 'Ingredients', value: product.seoMetadata?.ingredients || 'Proprietary Ayurvedic Blend' },
                      { label: 'Dosage', value: product.seoMetadata?.dosage || 'As directed by your physician' },
                    ].filter(item => item.value).map((item, i) => (
                      <div key={i} className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 sm:gap-6 p-4 sm:p-5 items-start">
                        <div className="text-gray-400 text-[11px] font-semibold uppercase tracking-wider pt-0.5">{item.label}</div>
                        <div className="text-plum-deep font-medium text-[14px] sm:text-[15px] leading-relaxed">{item.value}</div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Add to Cart Section */}
            <motion.div 
              id="buy"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="mt-6 bg-stone-100/50 border border-stone-200/60 p-6 rounded-2xl scroll-mt-28"
            >
              <div className="flex flex-col sm:flex-row gap-4">
                {cartItem ? (
                  <div className="flex items-center justify-between h-[52px] bg-white rounded-lg border border-stone-200 sm:w-40 px-1 focus-within:ring-2 focus-within:ring-gold-antique focus-within:border-transparent transition-shadow">
                    <button
                      onClick={() => updateQuantity(product.id, cartItem.quantity - 1)}
                      className="w-10 h-10 flex items-center justify-center text-plum-deep/60 hover:text-plum-deep transition-colors outline-none rounded focus-visible:ring-2 focus-visible:ring-gold-antique"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={16} strokeWidth={2} />
                    </button>
                    <span className="font-ibm-plex-mono font-medium text-plum-deep px-2 text-lg">{cartItem.quantity}</span>
                    <button
                      onClick={() => updateQuantity(product.id, cartItem.quantity + 1)}
                      className="w-10 h-10 flex items-center justify-center text-plum-deep/60 hover:text-plum-deep transition-colors outline-none rounded focus-visible:ring-2 focus-visible:ring-gold-antique"
                      aria-label="Increase quantity"
                    >
                      <Plus size={16} strokeWidth={2} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between h-[52px] bg-white rounded-lg border border-stone-200 sm:w-36 px-1 focus-within:ring-2 focus-within:ring-gold-antique focus-within:border-transparent transition-shadow">
                      <button
                        onClick={() => setLocalQuantity(prev => Math.max(1, prev - 1))}
                        className="w-10 h-10 flex items-center justify-center text-plum-deep/60 hover:text-plum-deep transition-colors outline-none rounded focus-visible:ring-2 focus-visible:ring-gold-antique"
                        aria-label="Decrease quantity"
                      >
                        <Minus size={16} strokeWidth={2} />
                      </button>
                      <span className="font-ibm-plex-mono font-medium text-plum-deep px-2 text-lg">{localQuantity}</span>
                      <button
                        onClick={() => setLocalQuantity(prev => prev + 1)}
                        className="w-10 h-10 flex items-center justify-center text-plum-deep/60 hover:text-plum-deep transition-colors outline-none rounded focus-visible:ring-2 focus-visible:ring-gold-antique"
                        aria-label="Increase quantity"
                      >
                        <Plus size={16} strokeWidth={2} />
                      </button>
                    </div>
                    
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleAddToCart}
                      disabled={product.stockStatus === 'out_of_stock'}
                      className="flex-1 h-[52px] bg-gold-antique hover:bg-[#A37E33] text-white rounded-lg font-semibold text-[15px] tracking-wide flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-[0_4px_14px_rgba(176,138,62,0.3)] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-ivory focus-visible:ring-gold-antique group"
                    >
                      <motion.div 
                        variants={{ click: { scale: [1, 1.3, 1], transition: { duration: 0.3 } } }}
                        whileTap="click"
                      >
                        <ShoppingCart size={18} strokeWidth={2} className="group-hover:opacity-100 opacity-90 transition-opacity" />
                      </motion.div>
                      ADD TO CART
                    </motion.button>
                  </>
                )}
              </div>
            </motion.div>

          </div>
        </div>

{/* Ratings & Reviews — approved reviews from the database (rendered
            server-side with the page), with the curated static list as the
            fallback when the reviews service is unreachable. */}
        <div className="mt-20 pt-16 border-t border-stone-200">
          <h3 className="text-3xl font-fraunces font-medium text-plum-deep mb-8">Ratings &amp; Reviews</h3>

          {ratingSummary.total === 0 ? (
            <div className="bg-white p-10 rounded-2xl border border-stone-100 text-center">
              <p className="text-lg text-stone-600 mb-1">Be the first to review</p>
              <p className="text-sm text-stone-400">
                No customer has reviewed this product yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
              {/* Left: summary + 5-to-1 breakdown */}
              <div className="bg-white p-6 rounded-2xl border border-stone-100 space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-fraunces font-bold text-plum-deep">
                    {ratingSummary.average.toFixed(1)}
                  </span>
                  <span className="text-stone-400">out of 5</span>
                </div>
                <div className="flex text-gold-antique">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={16}
                      className={s <= Math.round(ratingSummary.average) ? 'fill-gold-antique' : ''}
                    />
                  ))}
                </div>
                <p className="text-xs text-stone-500">
                  Based on {ratingSummary.total} review{ratingSummary.total === 1 ? '' : 's'}
                </p>

                {/* Every rating is shown. Nothing is filtered out, because a
                    distribution that hides the 1-star column is not a
                    distribution. */}
                <div className="space-y-1.5 pt-2">
                  {[5, 4, 3, 2, 1].map((stars) => {
                    const count = ratingSummary.breakdown[stars as 1 | 2 | 3 | 4 | 5];
                    const percent = ratingSummary.total
                      ? (count / ratingSummary.total) * 100
                      : 0;
                    return (
                      <div key={stars} className="flex items-center gap-2 text-xs">
                        <span className="w-8 text-stone-500">{stars} star</span>
                        <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gold-antique rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="w-6 text-right text-stone-400">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: the full list, every rating visible, sortable */}
              <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h4 className="text-lg font-fraunces font-medium text-plum-deep">
                    All {ratingSummary.total} review{ratingSummary.total === 1 ? '' : 's'}
                  </h4>
                  <label className="flex items-center gap-2 text-xs text-stone-500">
                    Sort
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as ReviewSort)}
                      className="border border-stone-200 rounded-lg px-2 py-1 text-xs bg-white"
                    >
                      <option value="newest">Newest</option>
                      <option value="highest">Highest rated</option>
                      <option value="lowest">Lowest rated</option>
                    </select>
                  </label>
                </div>

                {reviews.map((rev) => (
                  <article
                    key={rev.id}
                    className="bg-white p-6 rounded-2xl border border-stone-100 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-plum-deep">{rev.name}</span>
                          {rev.city && <span className="text-xs text-stone-400">{rev.city}</span>}
                          {/* Only when the review really is verified. */}
                          {rev.verified && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                              <BadgeCheck size={11} /> Verified
                            </span>
                          )}
                        </div>
                        {/* Renders all five slots so a 3-star review visibly shows
                            two empty stars — a hidden half-rating is misleading. */}
                        <div className="flex text-gold-antique mt-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              size={13}
                              className={s <= rev.rating ? 'fill-gold-antique' : ''}
                            />
                          ))}
                        </div>
                      </div>
                      <time dateTime={rev.date} className="text-xs text-stone-400">
                        {new Date(rev.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </time>
                    </div>
                    {rev.title && (
                      <h5 className="font-semibold text-plum-deep">{rev.title}</h5>
                    )}
                    <p className="text-sm text-stone-600 leading-relaxed">{rev.text}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
