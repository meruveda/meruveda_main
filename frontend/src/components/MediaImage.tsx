'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';
import { isStaticAsset } from '@/lib/mediaUrl';
import { FALLBACK_IMAGE } from '@/lib/productImage';

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
 *
 * If the image cannot be loaded at all (a deleted object, a storage hiccup)
 * the placeholder is shown instead of a broken-image icon. The failed source
 * is remembered, so a new source is tried again from scratch.
 */
export default function MediaImage(props: ImageProps) {
  const { src } = props;
  const staticAsset = typeof src === 'string' && isStaticAsset(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;
  const resolvedSrc = failed ? FALLBACK_IMAGE : src;

  return (
    <Image
      {...props}
      src={resolvedSrc}
      unoptimized={staticAsset || props.unoptimized === true || failed}
      onError={(event) => {
        props.onError?.(event);
        if (typeof src === 'string') setFailedSrc(src);
      }}
    />
  );
}
