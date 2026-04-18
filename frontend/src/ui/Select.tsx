"use client";

import * as S from "@radix-ui/react-select";
import { forwardRef, type ReactNode } from "react";
import { cn } from "./cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  className?: string;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      options,
      placeholder = "Select…",
      value,
      onValueChange,
      disabled,
      error,
      className,
    },
    ref,
  ) {
    return (
      <S.Root {...(value != null && { value })} {...(onValueChange != null && { onValueChange })} {...(disabled != null && { disabled })}>
        <S.Trigger
          ref={ref}
          className={cn(
            "inline-flex h-10 w-full items-center justify-between rounded-xl px-3.5 text-sm",
            "bg-[var(--glass-bg-1)] text-[var(--vf-color-text)]",
            "border border-[var(--glass-stroke-1)]",
            "outline-none focus:ring-2 focus:ring-[var(--aurora-2)] focus:border-transparent",
            "transition-colors duration-[var(--dur-fast)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "data-[placeholder]:text-[var(--vf-color-text-muted)]",
            error && "border-rose-500 focus:ring-rose-500",
            className,
          )}
        >
          <S.Value placeholder={placeholder} />
          <S.Icon className="ml-2 text-[var(--vf-color-text-muted)]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 5.5l3 3 3-3" />
            </svg>
          </S.Icon>
        </S.Trigger>
        <S.Portal>
          <S.Content
            position="popper"
            sideOffset={6}
            className={cn(
              "z-[var(--z-popover)] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-xl p-1",
              "glass-3 shadow-2xl",
              "animate-in fade-in-0 zoom-in-95",
            )}
          >
            <S.Viewport>
              {options.map((opt) => (
                <S.Item
                  key={opt.value}
                  value={opt.value}
                  {...(opt.disabled != null && { disabled: opt.disabled })}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none",
                    "text-[var(--vf-color-text)] hover:bg-[color-mix(in_oklab,currentColor_6%,transparent)]",
                    "data-[highlighted]:bg-[color-mix(in_oklab,currentColor_8%,transparent)]",
                    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
                  )}
                >
                  <S.ItemText>{opt.label}</S.ItemText>
                  <S.ItemIndicator className="ml-auto">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 7.5l3 3 5-6" />
                    </svg>
                  </S.ItemIndicator>
                </S.Item>
              ))}
            </S.Viewport>
          </S.Content>
        </S.Portal>
      </S.Root>
    );
  },
);
