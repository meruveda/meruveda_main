import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailClient';
import { API_BASE_URL } from '@/utils/apiUrl';
import { apiGetJson, shouldThrowOnFetchFailure } from '@/utils/apiFetch';

export const revalidate = 300; // ISR: public pages are revalidated every 5 minutes

  async function getProduct(id: string) {
    // Retried, and on total failure the error is THROWN so the App Router
    // keeps serving the last good ISR page for this product. The BUILD is the
    // exception: the backend is often not reachable while the frontend is
    // compiled, and that must not fail the deployment.
    try {
      const json = await apiGetJson<any>(`${API_BASE_URL}/products/${id}`, {
        next: { revalidate: 300 },
        label: 'Product/detail',
      });
      return json?.data ?? null;
    } catch (error) {
      if (!shouldThrowOnFetchFailure()) {
        console.warn('[Product/detail] the catalogue service was not reachable.');
        return null;
      }
      throw error;
    }
  }

  /**
   * Approved reviews for this product. The id may be a slug or a uuid — the
   * backend resolves both. Unlike the product itself, a failed reviews fetch
   * must NEVER take the page down: it degrades to "no reviews".
   */
  async function getProductReviews(id: string): Promise<any[]> {
    try {
      const json = await apiGetJson<any>(
        `${API_BASE_URL}/reviews?productId=${encodeURIComponent(id)}`,
        { next: { revalidate: 300 }, label: 'Product/reviews' },
      );
      return Array.isArray(json?.data) ? json.data : [];
    } catch {
      return [];
    }
  }

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) {
    return {
      title: "Product Not Found | MeruVeda"
    };
  }
  return {
    title: `${product.seoMetadata?.seoTitle || product.name} | MeruVeda`,
    description: product.seoMetadata?.seoDescription || product.description?.substring(0, 160) || "Authentic Ayurvedic Product",
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, reviews] = await Promise.all([getProduct(id), getProductReviews(id)]);

  if (!product) {
    notFound();
  }

  return (
    <div className="bg-ivory min-h-screen">
      <ProductDetailClient product={product} reviews={reviews} />
    </div>
  );
}
