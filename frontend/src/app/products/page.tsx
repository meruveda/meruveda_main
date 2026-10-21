export const revalidate = 300; // ISR: public pages are revalidated every 5 minutes
import ProductGrid from "@/components/ProductGrid";
import { API_BASE_URL } from "@/utils/apiUrl";
import { apiGetJson } from "@/utils/apiFetch";

export const metadata = {
  title: "All Products | MeruVeda",
  description: "Browse our authentic Ayurvedic products.",
};

async function getProducts() {
  const targetUrl = `${API_BASE_URL}/products`;
  // The backend is a separate service and can be COLD right after a deploy, so
  // the fetch is retried for about eight seconds in total.
  //
  // If it still fails, the error is THROWN rather than caught and rendered.
  // That is deliberate: in the App Router a render that throws keeps serving
  // the last good ISR page, while a render that catches the error and shows a
  // message REPLACES the good page with that message. A cold backend must
  // never empty the catalogue.
  const json = await apiGetJson<any>(targetUrl, { next: { revalidate: 300 }, label: 'Products' });
  const products = (json?.data || []).map((p: any) => {
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
      category: p.categoryName || 'Wellness',
      isFeatured: p.isFeatured,
      isBestSeller: p.isBestSeller,
      isTrending: p.isTrending,
      isRecommended: p.isRecommended,
      tag: (p.isFeatured === true || p.isFeatured === 'true') ? 'Featured' : undefined,
      gst: p.gst !== undefined ? p.gst : (p.seoMetadata?.gst !== undefined ? p.seoMetadata.gst : 18)
    };
  });
  return { products };
}

export default async function ProductsPage() {
  const { products } = await getProducts();

  return (
    <div className="container mx-auto px-6 py-12 md:py-24">
      <h1 className="text-4xl md:text-5xl font-playfair font-bold text-deep-purple mb-12 text-center">All Products</h1>
      <ProductGrid products={products} />
    </div>
  );
}

