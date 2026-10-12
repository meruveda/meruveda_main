export const dynamic = "force-dynamic";
import Image from "next/image";
import Link from "next/link";
import { Search, Leaf, ShieldCheck, Heart, Wind, Sparkles, Droplet, Star, ArrowRight } from "lucide-react";
import FeaturedProducts from "@/components/FeaturedProducts";
import HeroCarousel from "@/components/HeroCarousel";
import WhyChooseUs from "@/components/WhyChooseUs";
import { API_BASE_URL } from "@/utils/apiUrl";

export const metadata = {
  title: "MERUVEDA | Authentic Ayurvedic Products",
  description: "Authentic Ayurvedic medicines, lab-tested for purity and potency.",
};

async function getBanners() {
  try {
    const res = await fetch(`${API_BASE_URL}/banners`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch banners');
    }
    const json = await res.json();
    return json.data;
  } catch (error: any) {
    if (error?.cause?.code === 'ECONNREFUSED' || error?.message?.includes('fetch failed')) {
      console.warn('⚠️ Backend server (http://localhost:5000) not ready yet. Using default fallback banners.');
    } else {
      console.error('Error fetching banners:', error.message || error);
    }
    return [];
  }
}

async function getFeaturedProducts() {
  try {
    const res = await fetch(`${API_BASE_URL}/products?isFeatured=true&limit=4`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch featured products');
    }
    const json = await res.json();
    return json.data.map((p: any) => {
      let img = '/images/product_oil.png';
      if (p.images && Array.isArray(p.images) && p.images.length > 0 && typeof p.images[0] === 'string' && p.images[0].trim() !== '') {
        img = p.images[0];
      } else if (typeof p.images === 'string' && p.images.trim() !== '') {
        img = p.images;
      } else if (p.images && p.images[0] && typeof p.images[0] === 'object' && p.images[0].url) {
        img = p.images[0].url;
      }
      const price = (p.sellingPrice !== undefined && p.sellingPrice !== null && p.sellingPrice < p.price) ? p.sellingPrice : p.price;
      const originalPrice = (p.sellingPrice !== undefined && p.sellingPrice !== null && p.sellingPrice < p.price) ? p.price : null;
      const discount = originalPrice ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% OFF` : null;

      return {
        id: p.id,
        name: p.name,
        price,
        originalPrice,
        img,
        discount,
        isFeatured: true,
        isBestSeller: p.isBestSeller,
        isTrending: p.isTrending,
        isRecommended: p.isRecommended,
        tag: (p.isFeatured === true || p.isFeatured === 'true') ? 'Featured' : undefined,
        gst: p.gst !== undefined ? p.gst : (p.seoMetadata?.gst !== undefined ? p.seoMetadata.gst : 18)
      };
    });
  } catch (error: any) {
    if (error?.cause?.code === 'ECONNREFUSED' || error?.message?.includes('fetch failed')) {
      console.warn('⚠️ Backend server (http://localhost:5000) not ready yet. Using default fallback catalog.');
    } else {
      console.error('Error fetching featured products:', error.message || error);
    }
    return [];
  }
}

async function getFeaturedReviews() {
  try {
    const res = await fetch(`${API_BASE_URL}/reviews/featured`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || []).map((r: any) => ({
      text: r.comment || r.body || '',
      author: r.users ? `${r.users.first_name || ''} ${(r.users.last_name || '')[0] || ''}.`.trim() : (r.customerName || 'Customer'),
      product: r.products?.name || r.productName || '',
      rating: r.rating || 5,
    }));
  } catch {
    return [];
  }
}

async function getBlogPosts() {
  try {
    const res = await fetch(`${API_BASE_URL}/blogs?status=published`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch blog posts');
    }
    const json = await res.json();
    return json.data || [];
  } catch (error) {
    console.error('Error fetching blog posts for homepage:', error);
    return [];
  }
}

interface Review {
  text: string;
  author: string;
  product: string;
  rating: number;
}

export default async function Home() {
  const [products, banners, featuredReviews, blogPosts] = await Promise.all([
    getFeaturedProducts(),
    getBanners(),
    getFeaturedReviews(),
    getBlogPosts(),
  ]);

  const reviews = featuredReviews;
  const postsToShow = blogPosts.slice(0, 3);

  return (
    <div className="pb-20 relative">
      {/* Hero Slideshow Section */}
      <HeroCarousel initialBanners={banners} />

      {/* Products Section */}
      <section className="container mx-auto px-6 py-12 md:py-20 relative z-20">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-playfair font-bold text-deep-purple mb-4">Best Sellers</h2>
          <p className="text-gray-600">Discover our most loved Ayurvedic remedies.</p>
        </div>

        <FeaturedProducts products={products} />

        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 bg-gold text-deep-purple px-10 py-3.5 rounded-full font-bold hover:bg-gold-light transition-all shadow-md hover:shadow-lg w-full sm:w-auto justify-center"
          >
            Shop Now
            <ArrowRight size={18} />
          </Link>
          <Link href="/products" className="inline-flex items-center gap-2 bg-deep-purple text-white px-8 py-3 rounded-full font-medium hover:bg-deep-purple/90 transition-colors w-full sm:w-auto justify-center">
            View Full Catalog
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Why MeruVeda */}
      <WhyChooseUs />



      {/* Blog Section */}
      <section className="py-24 bg-ivory border-b border-gray-100">
        <div className="container mx-auto px-6">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-4xl font-playfair font-bold text-deep-purple mb-4">Ayurvedic Journal</h2>
              <p className="text-gray-600">Wisdom for modern holistic living.</p>
            </div>
            <Link href="/blog" className="hidden md:flex items-center gap-2 font-medium text-deep-purple border-b border-deep-purple pb-1 hover:text-gold hover:border-gold transition-colors">
              Read More
              <ArrowRight size={16} />
            </Link>
          </div>

          {postsToShow.length === 0 ? (
            <div className="text-center py-12 px-4 bg-white/60 backdrop-blur-md rounded-3xl border border-amber-100 shadow-sm max-w-xl mx-auto space-y-4">
              <p className="text-sm text-gray-500 font-light">No journal articles available yet. Check back soon!</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-8">
              {postsToShow.map((post: any, i: number) => {
                const formattedDate = post.publishedAt 
                  ? new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
                  : new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
                
                const category = (post.tags && post.tags.length > 0) ? post.tags[0] : 'Wellness';
                const img = post.featuredImage || '/images/blog_ashwagandha.png';
                const author = post.author || 'MERUVEDA';
                const slug = post.slug || post.id;
                const readTime = post.readTime || '5 min read';

                return (
                  <Link href={`/blog/${slug}`} key={post.id || i} className="group cursor-pointer flex flex-col h-full">
                    <div className="relative h-60 rounded-xl overflow-hidden mb-6">
                      <Image src={img} alt={post.title} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover group-hover:scale-105 transition-transform duration-500" />
                      <div className="absolute top-4 left-4 bg-gold text-deep-purple text-xs font-bold px-3 py-1 rounded-full shadow-md">
                        {category}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-rust font-medium mb-3">
                      <span>{formattedDate}</span>
                      <span className="text-gray-400 flex items-center gap-1"><Droplet size={14} className="opacity-0" />{readTime}</span>
                    </div>
                    <h3 className="text-xl font-playfair font-bold text-deep-purple group-hover:text-gold transition-colors mb-3 flex-1">{post.title}</h3>
                    <div className="text-sm text-gray-500 font-medium">By {author}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Testimonials */}
      {reviews.length > 0 && (
        <section className="py-24 bg-white">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-playfair font-bold text-deep-purple mb-4">What Our Community Says</h2>
              <div className="flex justify-center gap-1 mb-4">
                {[1, 2, 3, 4, 5].map(i => <Star key={i} className="text-gold fill-gold" size={24} />)}
              </div>
              <p className="text-gray-600">Trusted by thousands on their wellness journey.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {reviews.map((review: Review, i: number) => (
                <div key={i} className="bg-ivory p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg transition-shadow relative flex flex-col h-full">
                  <div className="text-gold opacity-20 text-6xl font-serif absolute top-4 left-4">&quot;</div>
                  <p className="text-gray-700 italic relative z-10 mb-6 mt-4 flex-1">&quot;{review.text}&quot;</p>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-rust text-white rounded-full flex items-center justify-center font-bold font-playfair text-xl flex-shrink-0">
                      {review.author[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <h5 className="font-bold text-deep-purple">{review.author}</h5>
                        <ShieldCheck size={14} className="text-green-600" />
                      </div>
                      <div className="flex text-gold mb-1">
                        {[1, 2, 3, 4, 5].map(star => <Star key={star} size={12} className={star <= (review.rating || 5) ? "fill-gold" : ""} />)}
                      </div>
                      <div className="text-xs text-gray-500 font-medium">Purchased: <span className="text-deep-purple">{review.product}</span></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
