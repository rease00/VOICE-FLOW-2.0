"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn";

type AvatarSize = "sm" | "md" | "lg" | "xl";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  size?: AvatarSize;
  fallback?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
  xl: "h-14 w-14 text-lg",
};

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { src, alt, size = "md", fallback, className, ...rest },
  ref,
) {
  const initials =
    fallback ??
    (alt
      ?.split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ??
      "?");

  return (
    <div
      ref={ref}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-[var(--glass-bg-2)] text-[var(--vf-color-text-muted)] font-medium",
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? ""}
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </div>
  );
});
