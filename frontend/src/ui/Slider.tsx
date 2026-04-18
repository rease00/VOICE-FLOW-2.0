"use client";

import * as S from "@radix-ui/react-slider";
import { forwardRef } from "react";
import { cn } from "./cn";

export interface SliderProps {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export const Slider = forwardRef<HTMLSpanElement, SliderProps>(
  function Slider({ className, ...rest }, ref) {
    return (
      <S.Root
        ref={ref}
        className={cn(
          "relative flex h-5 w-full touch-none select-none items-center",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...rest}
      >
        <S.Track className="relative h-1.5 grow rounded-full bg-[var(--glass-bg-2)]">
          <S.Range className="absolute h-full rounded-full bg-[var(--aurora-2)]" />
        </S.Track>
        <S.Thumb
          className={cn(
            "block h-4.5 w-4.5 rounded-full",
            "bg-white shadow-md border border-[var(--glass-stroke-1)]",
            "outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-2)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vf-color-bg)]",
            "transition-transform duration-100 hover:scale-110 active:scale-105",
          )}
        />
      </S.Root>
    );
  },
);
