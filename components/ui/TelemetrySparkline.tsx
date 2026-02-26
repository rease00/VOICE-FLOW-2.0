import React, { useMemo } from 'react';

interface TelemetrySparklineProps {
  values: number[];
  colorClassName?: string;
  glow?: boolean;
  title?: string;
}

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, value))
);

export const TelemetrySparkline: React.FC<TelemetrySparklineProps> = ({
  values,
  colorClassName = 'text-indigo-400',
  glow = false,
  title,
}) => {
  const { points, baseline } = useMemo(() => {
    const source = Array.isArray(values) && values.length > 1 ? values : [0, 0];
    const min = Math.min(...source);
    const max = Math.max(...source);
    const span = Math.max(1, max - min);
    const width = 80;
    const height = 24;
    const output = source.map((value, index) => {
      const x = (index / Math.max(1, source.length - 1)) * width;
      const y = height - (((value - min) / span) * height);
      return `${x.toFixed(2)},${clamp(y, 0, height).toFixed(2)}`;
    }).join(' ');
    const baselineY = height - (((0 - min) / span) * height);
    return {
      points: output,
      baseline: clamp(baselineY, 0, height),
    };
  }, [values]);

  return (
    <svg
      viewBox="0 0 80 24"
      className={`h-6 w-20 ${colorClassName} ${glow ? 'vf-telemetry-glow' : ''}`}
      role="img"
      aria-label={title || 'Telemetry sparkline'}
    >
      <line x1="0" y1={baseline} x2="80" y2={baseline} className="stroke-current opacity-15" strokeWidth="1" />
      <polyline
        points={points}
        fill="none"
        className="stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

