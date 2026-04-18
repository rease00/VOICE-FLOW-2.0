'use client';

import React, { useCallback, useState } from 'react';
import Image, { ImageProps } from 'next/image';

interface OptimizedAvatarProps extends Omit<ImageProps, 'alt' | 'src'> {
  src: string | null | undefined;
  alt: string;
  fallback?: React.ReactNode; // Fallback when no image or load fails
  containerClassName?: string;
}

/**
 * Optimized avatar image component with:
 * - Automatic next/image optimization
 * - Blur placeholder
 * - Lazy loading
 * - Error handling with fallback
 * - Responsive sizing
 */
export const OptimizedAvatar: React.FC<OptimizedAvatarProps> = ({
  src,
  alt,
  fallback = '?',
  containerClassName = '',
  className = 'h-full w-full object-cover',
  width = 40,
  height = 40,
  sizes,
  placeholder = 'blur',
  blurDataURL = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 40 40%27%3E%3Crect fill=%27%23f0f0f0%27 width=%2740%27 height=%2740%27/%3E%3C/svg%3E',
  quality = 85,
  loading = 'lazy',
  ...props
}) => {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const handleError = useCallback(() => {
    setImageError(true);
    setIsLoading(false);
  }, []);

  const handleLoadingComplete = useCallback(() => {
    setIsLoading(false);
  }, []);

  return (
    <div className={containerClassName}>
      {!imageError && src ? (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          className={className}
          placeholder={placeholder}
          blurDataURL={blurDataURL}
          quality={quality}
          loading={loading}
          onError={handleError}
          onLoadingComplete={handleLoadingComplete}
          {...props}
        />
      ) : (
        fallback
      )}
    </div>
  );
};

export default OptimizedAvatar;
