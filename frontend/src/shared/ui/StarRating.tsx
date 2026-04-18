'use client';

import React, { useCallback, useState } from 'react';
import { Star } from 'lucide-react';

export interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
  maxStars?: number;
  className?: string;
}

const SIZES = {
  sm: { star: 'h-4 w-4', touch: 'p-1' },
  md: { star: 'h-5 w-5', touch: 'p-1.5' },
  lg: { star: 'h-6 w-6', touch: 'p-2' },
} as const;

export default function StarRating({
  value,
  onChange,
  readOnly = false,
  size = 'md',
  maxStars = 5,
  className = '',
}: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayValue = hoverValue ?? value;
  const s = SIZES[size];

  const handleClick = useCallback(
    (star: number) => {
      if (readOnly || !onChange) return;
      onChange(star === value ? 0 : star);
    },
    [readOnly, onChange, value],
  );

  return (
    <div
      className={`inline-flex items-center ${className}`}
      role="group"
      aria-label={`Rating: ${value} out of ${maxStars} stars`}
    >
      {Array.from({ length: maxStars }, (_, i) => {
        const star = i + 1;
        const filled = star <= displayValue;
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            onClick={() => handleClick(star)}
            onMouseEnter={() => !readOnly && setHoverValue(star)}
            onMouseLeave={() => setHoverValue(null)}
            className={`${s.touch} transition-transform ${
              readOnly ? 'cursor-default' : 'cursor-pointer hover:scale-110 active:scale-95'
            }`}
            aria-label={`${star} star${star !== 1 ? 's' : ''}`}
          >
            <Star
              className={`${s.star} transition-colors ${
                filled
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-transparent text-slate-500'
              }`}
            />
          </button>
        );
      })}
      {!readOnly && (
        <span className="ml-1 text-xs text-slate-400">
          {value > 0 ? `${value}/${maxStars}` : ''}
        </span>
      )}
    </div>
  );
}

export function RatingDisplay({
  rating,
  count,
  className = '',
}: {
  rating: number;
  count: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <StarRating value={Math.round(rating)} readOnly size="sm" />
      <span className="text-xs text-slate-400">
        {rating.toFixed(1)} ({count})
      </span>
    </div>
  );
}
