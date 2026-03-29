import React from 'react';

interface ReaderArtworkProps {
  src?: string;
  title: string;
  kindLabel: string;
  decorative?: boolean;
  width: number;
  height: number;
  loading?: 'eager' | 'lazy';
  fetchPriority?: 'high' | 'low' | 'auto';
  className: string;
  fallbackClassName: string;
}

export const ReaderArtwork: React.FC<ReaderArtworkProps> = ({
  src,
  title,
  kindLabel,
  decorative = true,
  width,
  height,
  loading = 'lazy',
  fetchPriority = 'low',
  className,
  fallbackClassName,
}) => {
  const safeSrc = String(src || '').trim();
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [safeSrc]);

  if (!safeSrc || hasError) {
    return (
      <div className={fallbackClassName}>
        <span>{kindLabel}</span>
        <strong>{title}</strong>
      </div>
    );
  }

  return (
    <img
      src={safeSrc}
      alt={decorative ? '' : title}
      width={width}
      height={height}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      onError={() => setHasError(true)}
      className={className}
    />
  );
};
