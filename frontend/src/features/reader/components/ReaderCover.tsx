import React from 'react';

interface ReaderCoverProps {
  src?: string;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  alt?: string;
  variant?: 'card' | 'hero' | 'modal' | 'stage';
  loading?: 'eager' | 'lazy';
  fetchPriority?: 'high' | 'low';
  className?: string;
  imageClassName?: string;
}

export const ReaderCover: React.FC<ReaderCoverProps> = ({
  src,
  title,
  eyebrow,
  subtitle,
  alt,
  variant = 'card',
  loading = 'lazy',
  fetchPriority = 'low',
  className = '',
  imageClassName = '',
}) => {
  const [imageFailed, setImageFailed] = React.useState(false);
  const safeSrc = String(src || '').trim();
  const resolvedAlt = String(alt || title || '').trim();

  React.useEffect(() => {
    setImageFailed(false);
  }, [safeSrc]);

  const showImage = Boolean(safeSrc) && !imageFailed;

  return (
    <div className={`vf-reader-v2-cover vf-reader-v2-cover--${variant} ${className}`.trim()}>
      {showImage ? (
        <img
          className={`vf-reader-v2-cover__image ${imageClassName}`.trim()}
          src={safeSrc}
          alt={resolvedAlt}
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="vf-reader-v2-cover__fallback" aria-label={resolvedAlt}>
          {eyebrow ? <span className="vf-reader-v2-cover__eyebrow">{eyebrow}</span> : null}
          <strong className="vf-reader-v2-cover__title">{title}</strong>
          {subtitle ? <p className="vf-reader-v2-cover__subtitle">{subtitle}</p> : null}
        </div>
      )}
    </div>
  );
};

