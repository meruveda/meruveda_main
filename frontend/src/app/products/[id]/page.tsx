import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailClient';
import { API_BASE_URL } from '@/utils/apiUrl';
import { apiGetJson } from '@/utils/apiFetch';

export const revalidate = 300; // ISR: public pages are revalidated every 5 minutes

  async function getProduct(id: string) {
    // Retried, and on total failure the error is THROWN so the App Router
    // keeps serving the last good ISR page for this product.
    const json = await apiGetJson<any>(`${API_BASE_URL}/products/${id}`, {
      next: { revalidate: 300 },
      label: 'Product/detail',
    });
    return json?.data ?? null;
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
  const product = await getProduct(id);

  if (!product) {
    notFound();
  }

  return (
    <div className="bg-ivory min-h-screen">
      <ProductDetailClient product={product} />
    </div>
  );
}
