import Image, { type ImageProps } from 'next/image';
import { isStaticAsset } from '@/lib/mediaUrl';

/**
 * `next/image` with the right optimisation strategy per source.
 *
 * A static asset (`/images/...` or an absolute URL on the storefront's own
 * host) is already stored in its final, optimised form — resizing it again
 * would only cost a round-trip. It is therefore marked `unoptimized`, which
 * also keeps Next from warning that a custom loader "does not implement
 * width" (the loader is never called for those sources).
 *
 * Every other source (freshly uploaded media on R2) keeps the default path:
 * the custom loader hands it to the backend derivative proxy, which resizes
 * and caches it.
 */
export default function MediaImage(props: ImageProps) {
  const { src } = props;
  const staticAsset = typeof src === 'string' && isStaticAsset(src);
  return <Image {...props} unoptimized={staticAsset || props.unoptimized === true} />;
}
