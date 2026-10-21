import { RefreshCw, Leaf } from "lucide-react";

/**
 * The friendly "the catalogue is still loading" state.
 *
 * It is shown in exactly one situation: the FIRST render of a page, when the
 * backend could not be reached (usually because it is still booting after a
 * deploy) and there is no cached page to fall back to.
 *
 * It never shows a stack trace, an internal URL or any debug output.
 */
export function CatalogueLoading({ label = "products" }: { label?: string }) {
  return (
    <div className="text-center py-16 md:py-24">
      <div className="w-16 h-16 mx-auto rounded-full bg-deep-purple/10 text-deep-purple flex items-center justify-center mb-6">
        <Leaf size={28} />
      </div>
      <h2 className="text-2xl font-playfair font-bold text-deep-purple mb-3">
        Loading {label}, please refresh
      </h2>
      <p className="text-sm text-gray-600 max-w-md mx-auto mb-8">
        We are fetching the catalogue right now and it is taking a little longer
        than usual. Please try again in a moment.
      </p>
      <a
        href=""
        className="inline-flex items-center gap-2 bg-deep-purple text-white px-7 py-3 rounded-xl font-bold text-sm hover:bg-deep-purple/90 transition-colors"
      >
        <RefreshCw size={16} />
        Retry
      </a>
    </div>
  );
}

export default CatalogueLoading;
