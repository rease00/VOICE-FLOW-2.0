"use client";

import * as T from "@radix-ui/react-tabs";
import { type ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Tabs({
  items,
  defaultValue,
  value,
  onValueChange,
  className,
}: TabsProps) {
  return (
    <T.Root
      {...(defaultValue != null ? { defaultValue } : items[0] && { defaultValue: items[0].value })}
      {...(value != null && { value })}
      {...(onValueChange != null && { onValueChange })}
      className={className}
    >
      <T.List className="flex gap-1 border-b border-[var(--glass-stroke-1)]">
        {items.map((tab) => (
          <T.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={cn(
              "relative px-3 py-2 text-sm font-medium",
              "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]",
              "outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-2)] focus-visible:rounded-md",
              "transition-colors duration-[var(--dur-fast)]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "data-[state=active]:text-[var(--vf-color-text)]",
              "data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-[var(--aurora-2)] data-[state=active]:after:rounded-full",
            )}
          >
            {tab.label}
          </T.Trigger>
        ))}
      </T.List>
      {items.map((tab) => (
        <T.Content
          key={tab.value}
          value={tab.value}
          className="mt-4 outline-none"
        >
          {tab.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
