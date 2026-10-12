export const dynamic = "force-dynamic";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Calendar, Clock, ArrowLeft } from "lucide-react";
import { API_BASE_URL } from "@/utils/apiUrl";
import { notFound } from "next/navigation";

async function getPost(slug: string) {
  try {
    // Try fetching by slug first, then by ID as fallback
    const res = await fetch(`${API_BASE_URL}/blogs/${slug}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || json;
  } catch {
    return null;
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const formattedDate = post.publishedAt
    ? new Date(post.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : new Date(post.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const category = post.tags && post.tags.length > 0 ? post.tags[0] : "Wellness";
  const img = post.featuredImage || "/images/blog_ashwagandha.png";

  return (
    <div className="bg-ivory min-h-screen pb-20">
      {/* Breadcrumb */}
      <div className="container mx-auto px-6 pt-8 pb-4 max-w-4xl">
        <nav className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/" className="hover:text-gold transition-colors">Home</Link>
          <ChevronRight size={14} />
          <Link href="/blog" className="hover:text-gold transition-colors">Journal</Link>
          <ChevronRight size={14} />
          <span className="text-deep-purple font-medium truncate max-w-xs">{post.title}</span>
        </nav>
      </div>

      <div className="container mx-auto px-6 max-w-4xl">
        {/* Category + date */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-xs font-bold uppercase tracking-widest text-rust bg-rust/10 px-3 py-1 rounded-full">
            {category}
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Calendar size={12} /> {formattedDate}
          </span>
          {post.readTime && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={12} /> {post.readTime}
            </span>
          )}
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-playfair font-bold text-deep-purple leading-tight mb-8">
          {post.title}
        </h1>

        {/* Author */}
        {post.author && (
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-full bg-deep-purple text-gold flex items-center justify-center font-bold text-sm">
              {String(post.author)[0]?.toUpperCase() || "A"}
            </div>
            <div>
              <p className="font-semibold text-deep-purple text-sm">{post.author}</p>
              <p className="text-xs text-gray-400">MERUVEDA Wellness Team</p>
            </div>
          </div>
        )}

        {/* Featured Image */}
        <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden mb-12 shadow-lg">
          <Image
            src={img}
            alt={post.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 896px"
            priority
          />
        </div>

        {/* Excerpt */}
        {post.excerpt && (
          <p className="text-xl text-gray-600 font-light leading-relaxed mb-10 italic border-l-4 border-gold pl-6">
            {post.excerpt}
          </p>
        )}

        {/* Content */}
        <article className="bg-white p-8 md:p-12 rounded-2xl shadow-sm border border-gray-100">
          {post.content ? (
            <div
              className="prose prose-lg max-w-none text-gray-700 leading-relaxed
                prose-headings:font-playfair prose-headings:text-deep-purple
                prose-a:text-gold prose-a:no-underline hover:prose-a:underline
                prose-img:rounded-xl"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />
          ) : (
            <p className="text-gray-500 italic">Content not available.</p>
          )}
        </article>

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-8">
            {post.tags.map((tag: string, i: number) => (
              <span
                key={i}
                className="text-xs font-medium px-3 py-1 bg-deep-purple/10 text-deep-purple rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Back */}
        <div className="mt-12">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-deep-purple font-medium hover:text-gold transition-colors"
          >
            <ArrowLeft size={16} /> Back to Journal
          </Link>
        </div>
      </div>
    </div>
  );
}
