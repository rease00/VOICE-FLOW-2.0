"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { fadeIn } from "@/ui/motion";
import { ChevronLeft, ChevronRight, Type, Minus, Plus } from "lucide-react";

interface TextCanvasProps {
  /** The text content to display — can be multi-paragraph */
  content: string;
  /** Title of the current chapter/section */
  chapterTitle?: string;
  /** Currently playing paragraph index (highlight it) */
  activeIndex?: number;
  /** Font size in px */
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  /** Called when a paragraph is tapped (to seek playback) */
  onParagraphClick?: (index: number) => void;
}

const MIN_FONT = 14;
const MAX_FONT = 28;

export function TextCanvas({
  content,
  chapterTitle,
  activeIndex = -1,
  fontSize,
  onFontSizeChange,
  onParagraphClick,
}: TextCanvasProps) {
  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const activeRef = useRef<HTMLParagraphElement>(null);

  // Auto-scroll to active paragraph
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeIndex]);

  return (
    <Card elevation={1} className="flex min-h-[420px] flex-col overflow-hidden">
      {/* Reading toolbar */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <div className="flex items-center gap-2">
          <Type className="h-3.5 w-3.5 text-[var(--vf-color-text-muted)]" />
          <button
            type="button"
            onClick={() => onFontSizeChange(Math.max(MIN_FONT, fontSize - 2))}
            disabled={fontSize <= MIN_FONT}
            className="rounded p-1 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)] disabled:opacity-30"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="min-w-[3ch] text-center text-xs tabular-nums text-[var(--vf-color-text-muted)]">
            {fontSize}
          </span>
          <button
            type="button"
            onClick={() => onFontSizeChange(Math.min(MAX_FONT, fontSize + 2))}
            disabled={fontSize >= MAX_FONT}
            className="rounded p-1 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)] disabled:opacity-30"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <span className="text-xs text-[var(--vf-color-text-muted)]">
          {paragraphs.length} paragraphs
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {chapterTitle && (
          <h2 className="mb-6 text-lg font-semibold text-[var(--vf-color-text)]">
            {chapterTitle}
          </h2>
        )}

        {paragraphs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-sm text-[var(--vf-color-text-muted)]">
              Import a book or paste text to start reading with AI voices.
            </p>
          </div>
        ) : (
          <article className="prose prose-invert max-w-none">
            {paragraphs.map((para, i) => (
              <motion.p
                key={i}
                ref={i === activeIndex ? activeRef : undefined}
                onClick={() => onParagraphClick?.(i)}
                initial={{ opacity: 0.7 }}
                animate={{
                  opacity: i === activeIndex ? 1 : 0.7,
                }}
                className={cn(
                  "cursor-pointer rounded-lg px-2 py-1 transition-colors",
                  "leading-relaxed text-[var(--vf-color-text)]",
                  i === activeIndex
                    ? "bg-[var(--aurora-2)]/10 ring-1 ring-[var(--aurora-2)]/20"
                    : "hover:bg-white/5",
                )}
                style={{ fontSize: `${fontSize}px` }}
              >
                {para}
              </motion.p>
            ))}
          </article>
        )}
      </div>
    </Card>
  );
}
