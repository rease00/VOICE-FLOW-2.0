"use client";

import * as S from "@radix-ui/react-switch";
import { forwardRef } from "react";
import { cn } from "./cn";

type SwitchSize = "sm" | "md";

export interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: SwitchSize;
  className?: string;
  id?: string;
  name?: string;
}

const rootSizes: Record<SwitchSize, string> = {
  sm: "h-5 w-9",
  md: "h-6 w-11",
};

const thumbSizes: Record<SwitchSize, string> = {
  sm: "h-3.5 w-3.5 data-[state=checked]:translate-x-[18px]",
  md: "h-4.5 w-4.5 data-[state=checked]:translate-x-[22px]",
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, onCheckedChange, disabled, size = "md", className, ...rest },
    ref,
  ) {
    return (
      <S.Root
        ref={ref}
        {...(checked != null && { checked })}
        {...(onCheckedChange != null && { onCheckedChange })}
        {...(disabled != null && { disabled })}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer items-center rounded-full",
          "bg-[var(--glass-bg-2)] data-[state=checked]:bg-[var(--aurora-2)]",
          "outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-2)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vf-color-bg)]",
          "transition-colors duration-200",
          "disabled:cursor-not-allowed disabled:opacity-50",
          rootSizes[size],
          className,
        )}
        {...rest}
      >
        <S.Thumb
          className={cn(
            "pointer-events-none block rounded-full bg-white shadow-sm",
            "translate-x-1 transition-transform duration-200",
            thumbSizes[size],
          )}
        />
      </S.Root>
    );
  },
);
