"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Minus, Plus, ShoppingCart, Sparkles, Droplets, Star, Loader2, ArrowRight } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

export default function ProductDetailClient({ product }: { product: any }) {
  const { addToCartGuarded, cart, updateQuantity } = useCart();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const [mainImage, setMainImage] = useState(
    product.images?.[0]?.url || product.thumbnail || '/images/placeholder.jpg'
  );
  
  const [localQuantity, setLocalQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState('description');

  const [reviews, setReviews] = useState<any[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState(false);

  React.useEffect(() => {
    const fetchReviews = async () => {
      try {
        const { default: axiosInstance } = await import('@/api/axiosInstance');
        const res = await axiosInstance.get(`/reviews?productId=${product.id}&status=approved`);
        if (res.data?.data) {
          setReviews(res.data.data);
        }
      } catch (err) {
        console.error("Failed to fetch reviews", err);
      } finally {
        setLoadingReviews(false);
      }
    };
    fetchReviews();
  }, [product.id, reviewSuccess]);

  React.useEffect(() => {
    if (!isAuthenticated) return;
    const checkPurchase = async () => {
      try {
        const { default: axiosInstance } = await import('@/api/axiosInstance');
        const res = await axiosInstance.get('/orders/my');
        const orders = res.data?.data || [];
        const bought = orders.some((order: any) => 
          (order.order_items || []).some((item: any) => item.product_id === product.id)
        );
        setHasPurchased(bought);
      } catch (err) {
        console.error("Failed to verify purchase history", err);
      }
    };
    checkPurchase();
  }, [isAuthenticated, product.id]);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReviewError(null);
    setReviewSuccess(false);
    setSubmittingReview(true);

    try {
      const { default: axiosInstance } = await import('@/api/axiosInstance');
      await axiosInstance.post('/reviews', {
        product_id: product.id,
        rating: newRating,
        comment: newComment
      });
      setReviewSuccess(true);
      setNewComment('');
      setNewRating(5);
    } catch (err: any) {
      setReviewError(err.response?.data?.error?.message || err.message || "Failed to submit review");
    } finally {
      setSubmittingReview(false);
    }
  };

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
                <Image 
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
            {product.images && product.images.length > 1 && (
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                {product.images.map((img: any, idx: number) => (
                  <button 
                    key={idx}
                    onClick={() => setMainImage(img.url)}
                    className={`relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 transition-all border ${mainImage === img.url ? 'border-gold-antique' : 'border-transparent bg-stone-100 hover:border-gold-antique/50'}`}
                  >
                    <div className="absolute inset-0 p-2">
                      <Image src={img.url} alt={`${product.name} thumbnail ${idx + 1}`} fill sizes="80px" className="object-contain" />
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

        {/* Ratings & Reviews Section */}
        <div className="mt-20 pt-16 border-t border-stone-200">
          <h3 className="text-3xl font-fraunces font-medium text-plum-deep mb-8">Ratings & Reviews</h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
            {/* Left: Summary */}
            <div className="bg-white p-6 rounded-2xl border border-stone-100 space-y-4">
              <h4 className="text-lg font-bold text-plum-deep uppercase tracking-wider text-xs">Customer Sentiment</h4>
              {reviews.length > 0 ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-5xl font-fraunces font-bold text-plum-deep">
                      {(reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)}
                    </span>
                    <div>
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => {
                          const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
                          return (
                            <Star
                              key={i}
                              size={16}
                              className={`${
                                i < Math.round(avg) ? 'text-gold-antique fill-gold-antique' : 'text-stone-200'
                              }`}
                            />
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Based on {reviews.length} reviews</p>
                    </div>
                  </div>
                  
                  {/* Rating bars */}
                  <div className="space-y-2 pt-2">
                    {[5, 4, 3, 2, 1].map((stars) => {
                      const count = reviews.filter(r => r.rating === stars).length;
                      const percent = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                      return (
                        <div key={stars} className="flex items-center gap-3 text-xs text-plum-deep/80">
                          <span className="w-3 text-right font-medium">{stars}</span>
                          <Star size={12} className="text-gold-antique fill-gold-antique" />
                          <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                            <div className="h-full bg-gold-antique rounded-full" style={{ width: `${percent}%` }} />
                          </div>
                          <span className="w-8 text-right text-gray-400">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">No reviews yet for this product. Be the first to share your thoughts!</p>
              )}
            </div>

            {/* Right/Middle: Reviews List & Write Form */}
            <div className="lg:col-span-2 space-y-10">
              {/* Write a Review Card */}
              <div className="bg-white p-6 rounded-2xl border border-stone-100">
                <h4 className="text-lg font-fraunces font-medium text-plum-deep mb-4">Write a Customer Review</h4>
                {!isAuthenticated ? (
                  <p className="text-sm text-gray-500">
                    Please{' '}
                    <button 
                      onClick={() => router.push(`/login?returnUrl=/products/${product.id}`)}
                      className="text-gold-antique font-semibold hover:underline"
                    >
                      log in
                    </button>{' '}
                    to leave a review.
                  </p>
                ) : !hasPurchased ? (
                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-800 leading-relaxed">
                    🛡️ <strong>Verified Buyer Check:</strong> You can only review products you have purchased. If you bought this product recently, please make sure your order status is updated.
                  </div>
                ) : reviewSuccess ? (
                  <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-800">
                    🎉 Thank you! Your review has been submitted and is awaiting approval.
                  </div>
                ) : (
                  <form onSubmit={handleReviewSubmit} className="space-y-4">
                    {reviewError && (
                      <div className="p-3 bg-rose-50 border border-rose-100 text-xs text-rose-700 rounded-lg">
                        {reviewError}
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Rating</label>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((num) => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => setNewRating(num)}
                            className="hover:scale-115 transition-transform"
                          >
                            <Star
                              size={28}
                              className={`${
                                num <= newRating ? 'text-gold-antique fill-gold-antique' : 'text-stone-200'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Review Comment</label>
                      <textarea
                        required
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Share your experience using this product. What did you like or dislike?"
                        className="w-full min-h-[100px] border border-stone-200 rounded-xl p-3 text-sm focus:border-gold-antique focus:ring-1 focus:ring-gold-antique outline-none transition-all"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submittingReview}
                      className="px-6 h-[44px] bg-gold-antique hover:bg-[#A37E33] disabled:opacity-50 text-white rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
                    >
                      {submittingReview && <Loader2 size={14} className="animate-spin" />}
                      Submit Review
                    </button>
                  </form>
                )}
              </div>

              {/* Reviews List */}
              <div className="space-y-6">
                <h4 className="text-lg font-fraunces font-medium text-plum-deep border-b border-stone-100 pb-3">
                  Reviews ({reviews.length})
                </h4>
                {loadingReviews ? (
                  <div className="flex items-center gap-2 text-stone-400 text-sm">
                    <Loader2 size={16} className="animate-spin" /> Loading reviews...
                  </div>
                ) : reviews.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No approved reviews yet.</p>
                ) : (
                  <div className="space-y-6 divide-y divide-stone-100">
                    {reviews.map((rev) => (
                      <div key={rev.id} className="pt-6 first:pt-0 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm text-plum-deep">
                            {rev.users ? `${rev.users.first_name || ''} ${rev.users.last_name || ''}`.trim() || 'Verified Customer' : 'Verified Customer'}
                          </p>
                          <span className="text-xs text-gray-400">
                            {new Date(rev.created_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric"
                            })}
                          </span>
                        </div>
                        
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              size={12}
                              className={`${
                                i < rev.rating ? 'text-gold-antique fill-gold-antique' : 'text-stone-200'
                              }`}
                            />
                          ))}
                        </div>
                        
                        <p className="text-sm text-plum-deep/80 leading-relaxed italic">"{rev.comment || rev.body}"</p>
                        
                        {rev.reply && (
                          <div className="ml-6 mt-3 bg-stone-50 border border-stone-100 p-4 rounded-xl text-xs space-y-1">
                            <p className="font-bold text-[#C09E5A]">🛡️ Response from MeruVeda Wellness</p>
                            <p className="text-plum-deep/80 leading-relaxed">{rev.reply}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

