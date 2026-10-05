'use client';

import { useState } from 'react';
import { FiImage } from 'react-icons/fi';
import { useI18n } from '@/lib/i18n';

interface ProductImageProps {
  src?: string | null;
  alt: string;
  /** Classes for the frame; it controls size and aspect ratio. */
  className?: string;
  /** contain keeps the whole product visible (detail pages); cover fills the frame (grids). */
  fit?: 'cover' | 'contain';
  /** Applied to the <img>, e.g. a group-hover zoom on cards. */
  imageClassName?: string;
  /** Hide the "no image" caption on small thumbnails. */
  compact?: boolean;
  /** The above-the-fold image of a page (its Largest Contentful Paint): load it eagerly and first. */
  priority?: boolean;
}

/**
 * Product image frame with lazy loading and a neutral fallback for missing or
 * broken URLs. Images are admin-entered URLs on arbitrary hosts, so this stays a
 * plain <img> rather than next/image.
 */
export default function ProductImage({ src, alt, className = '', fit = 'cover', imageClassName = '', compact = false, priority = false }: ProductImageProps) {
  const { t } = useI18n();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div className={`relative overflow-hidden bg-gray-50 ${className}`}>
      {showImage ? (
        <img
          src={src!}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onError={() => setFailedSrc(src!)}
          className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${imageClassName}`}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-300" role="img" aria-label={alt}>
          <FiImage className={compact ? 'h-6 w-6' : 'h-10 w-10'} aria-hidden="true" />
          {!compact && <span className="text-xs text-gray-400">{t('暂无图片')}</span>}
        </div>
      )}
    </div>
  );
}
