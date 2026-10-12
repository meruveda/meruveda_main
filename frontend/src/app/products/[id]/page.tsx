import { notFound } from 'next/navigation';
import ProductDetailClient from './ProductDetailClient';
import { API_BASE_URL } from '@/utils/apiUrl';

export const dynamic = "force-dynamic";

async function getProduct(id: string) {
  try {
    const res = await fetch(`${API_BASE_URL}/products/${id}`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Failed to fetch product');
    }
    const json = await res.json();
    return json.data;
  } catch (error) {
    console.error(error);
    return null;
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
