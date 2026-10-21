export const revalidate = 60; // ISR: the admin drops this cache right after a save (see /api/revalidate); 60s is the fallback
import ProductGrid from "@/components/ProductGrid";
import { API_BASE_URL } from "@/utils/apiUrl";
import { apiGetJson, shouldThrowOnFetchFailure } from "@/utils/apiFetch";
import { CatalogueLoading } from "@/components/CatalogueLoading";
import { getMainImageUrl } from "@/lib/productImage";

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
  //
  // The one exception is the BUILD: the new frontend is compiled before the
  // new backend is live, so the backend is often unreachable while the build
  // runs. Failing the deployment for that would be wrong, so the build renders
  // a friendly placeholder and the first real request revalidates the page.
  let json: any;
  try {
    json = await apiGetJson<any>(targetUrl, { next: { revalidate: 60, tags: ['products'] }, label: 'Products' });
  } catch (error) {
    if (!shouldThrowOnFetchFailure()) {
      console.warn('[Products] the catalogue service was not reachable.');
      return { products: [], unavailable: true };
    }
    throw error;
  }
  const products = (json?.data || []).map((p: any) => {
    // The MAIN image is the first one, whatever shape the catalogue stores it
    // in (plain urls or {id,url,alt} entries).
    const img = getMainImageUrl(p.images, '/images/product_oil.png');
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
  const { products, unavailable } = await getProducts();

  return (
    <div className="container mx-auto px-6 py-12 md:py-24">
      <h1 className="text-4xl md:text-5xl font-playfair font-bold text-deep-purple mb-12 text-center">All Products</h1>
      {unavailable ? <CatalogueLoading /> : <ProductGrid products={products} />}
    </div>
  );
}

