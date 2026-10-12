export const dynamic = "force-dynamic";
import Image from "next/image";
import Link from "next/link";
import { API_BASE_URL } from "@/utils/apiUrl";

async function getBlogPosts() {
  try {
    const res = await fetch(`${API_BASE_URL}/blogs?status=published`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error('Failed to fetch blog posts');
    }
    const json = await res.json();
    return json.data;
  } catch (error) {
    console.error(error);
    return [];
  }
}

export default async function BlogPage() {
  const posts = await getBlogPosts();

  return (
    <div className="bg-amber-50/20 min-h-screen">
      <div className="container mx-auto px-6 py-16 md:py-24 max-w-6xl">
        {/* Page Header */}
        <div className="text-center max-w-2xl mx-auto mb-16 space-y-4">
          <span className="text-xs uppercase font-semibold tracking-widest text-rust">Wisdom & Wellness</span>
          <h1 className="text-4xl md:text-5xl font-playfair font-bold text-deep-purple">Ayurvedic Journal</h1>
          <div className="h-0.5 w-16 bg-gold/60 mx-auto mt-4"></div>
          <p className="text-sm text-gray-500 font-light leading-relaxed">
            Explore ancient principles adapted for modern lifestyles. Discover herbal remedies, dietary guides, and mindful practices for holistic living.
          </p>
        </div>
        
        {posts.length === 0 ? (
          /* Premium Empty State */
          <div className="text-center py-20 px-4 bg-white/60 backdrop-blur-md rounded-3xl border border-amber-100 shadow-sm max-w-xl mx-auto space-y-6">
            <div className="w-16 h-16 bg-amber-50 text-gold rounded-full flex items-center justify-center mx-auto shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-playfair font-bold text-deep-purple">No journal articles available yet</h3>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Our practitioners are currently crafting mindful insights and natural remedies. Check back soon for new readings!
              </p>
            </div>
          </div>
        ) : (
          /* Magazine-Style Grid */
          <div className="grid md:grid-cols-2 gap-x-12 gap-y-16 max-w-4xl mx-auto">
            {posts.map((post: any, i: number) => {
              const formattedDate = post.publishedAt 
                ? new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
                : new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
              
              const category = (post.tags && post.tags.length > 0) ? post.tags[0] : 'Wellness';
              const img = post.featuredImage || '/images/blog_ashwagandha.png';
              const postExcerpt = post.excerpt || (post.content ? (post.content.replace(/<[^>]*>/g, '').slice(0, 140) + '...') : '');

              return (
                <Link href={`/blog/${post.slug || post.id}`} key={post.id || i}>
                <article key={post.id || i} className="group flex flex-col space-y-4">
                  {/* Image Card Container */}
                  <div className="relative aspect-[16/10] w-full rounded-2xl overflow-hidden shadow-sm border border-slate-100/10">
                    <Image 
                      src={img} 
                      alt={post.title} 
                      fill 
                      sizes="(max-width: 768px) 100vw, 50vw" 
                      className="object-cover group-hover:scale-102 transition-transform duration-700 ease-out" 
                    />
                    {/* Category pill overlaid top-left */}
                    <div className="absolute top-4 left-4 backdrop-blur-sm text-xs font-bold px-4 py-1.5 rounded-full shadow-sm tracking-wider uppercase" style={{ backgroundColor: '#ffffff', color: '#2d1b4e' }}>
                      {category}
                    </div>
                  </div>

                  {/* Text details below the image */}
                  <div className="space-y-2">
                    <div className="text-xs text-rust font-semibold tracking-wider">{formattedDate}</div>
                    <h3 className="text-2xl font-playfair font-bold text-deep-purple group-hover:text-gold transition-colors duration-300 leading-snug">
                      {post.title}
                    </h3>
                    <p className="text-gray-500 font-light text-sm leading-relaxed line-clamp-2">
                      {postExcerpt}
                    </p>
                  </div>
                </article>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
