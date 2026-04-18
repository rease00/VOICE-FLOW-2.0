"use client";

import { cn } from "./cn";

type ProgressRingSize = "sm" | "md" | "lg";

export interface ProgressRingProps {
  value: number;
  max?: number;
  size?: ProgressRingSize;
  className?: string;
}

const dims: Record<ProgressRingSize, { size: number; stroke: number }> = {
  sm: { size: 20, stroke: 2.5 },
  md: { size: 32, stroke: 3 },
  lg: { size: 48, stroke: 4 },
};

export function ProgressRing({
  value,
  max = 100,
  size = "md",
  className,
}: ProgressRingProps) {
  const { size: s, stroke } = dims[size];
  const r = (s - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(Math.max(value / max, 0), 1);
  const offset = circumference * (1 - pct);

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("rotate-[-90deg]", className)}
    >
      <circle
        cx={s / 2}
        cy={s / 2}
        r={r}
        fill="none"
        stroke="var(--glass-stroke-1)"
        strokeWidth={stroke}
      />
      <circle
        cx={s / 2}
        cy={s / 2}
        r={r}
        fill="none"
        stroke="var(--aurora-2)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  );
}
