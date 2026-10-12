export const dynamic = "force-dynamic";
import ProductGrid from "@/components/ProductGrid";
import { API_BASE_URL } from "@/utils/apiUrl";

export const metadata = {
  title: "All Products | MeruVeda",
  description: "Browse our authentic Ayurvedic products.",
};

async function getProducts() {
  const targetUrl = `${API_BASE_URL}/products`;
  try {
    const res = await fetch(targetUrl, {
      cache: 'no-store'
    });
    if (!res.ok) {
      // Log the full internal URL server-side only — never expose the
      // backend service origin (vercel-infra.com) to the browser.
      console.error(`[Products] backend fetch failed: ${targetUrl} -> ${res.status} ${res.statusText}`);
      throw new Error(
        `Products service returned ${res.status}. Please check the backend service logs and /api/health.`
      );
    }
    const json = await res.json();
    return {
      products: json.data.map((p: any) => {
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
      }),
      error: null
    };
  } catch (error: any) {
    console.error(error);
    return {
      products: [],
      error: error.message || String(error)
    };
  }
}

export default async function ProductsPage() {
  const { products, error } = await getProducts();

  return (
    <div className="container mx-auto px-6 py-12 md:py-24">
      <h1 className="text-4xl md:text-5xl font-playfair font-bold text-deep-purple mb-12 text-center">All Products</h1>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-center font-mono text-sm">
          <strong>Debug Info:</strong> {error}
        </div>
      )}
      <ProductGrid products={products} />
    </div>
  );
}

