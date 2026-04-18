"use client";

import { useCallback, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { fadeIn } from "@/ui/motion";
import { AlignLeft, Columns, Wand2 } from "lucide-react";
import type { StudioEditorMode } from "../../../../types";

interface EditorPaneProps {
  text: string;
  onChange: (text: string) => void;
  editorMode: StudioEditorMode;
  onEditorModeChange: (mode: StudioEditorMode) => void;
  disabled?: boolean;
}

const PLACEHOLDER = `Type or paste your script here…

For multi-speaker, use the format:
[Speaker Name]: Their dialogue text here.
[Narrator]: Description or narration.`;

const MAX_CHARS = 100_000;

export function EditorPane({
  text,
  onChange,
  editorMode,
  onEditorModeChange,
  disabled = false,
}: EditorPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      if (val.length <= MAX_CHARS) {
        onChange(val);
      }
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newVal = text.substring(0, start) + "  " + text.substring(end);
        onChange(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [text, onChange],
  );

  return (
    <Card elevation={2} className="flex min-h-[420px] flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEditorModeChange("raw")}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              editorMode === "raw"
                ? "bg-white/10 text-[var(--vf-color-text)]"
                : "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]",
            )}
          >
            <AlignLeft className="mr-1 inline h-3.5 w-3.5" />
            Script
          </button>
          <button
            type="button"
            onClick={() => onEditorModeChange("blocks")}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              editorMode === "blocks"
                ? "bg-white/10 text-[var(--vf-color-text)]"
                : "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]",
            )}
          >
            <Columns className="mr-1 inline h-3.5 w-3.5" />
            Blocks
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-[var(--vf-color-text-muted)]">
            {wordCount.toLocaleString()} words · {charCount.toLocaleString()}/{MAX_CHARS.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Editor area */}
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          className={cn(
            "h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed",
            "text-[var(--vf-color-text)] placeholder:text-[var(--vf-color-text-muted)]/40",
            "outline-none",
            "min-h-[360px]",
            disabled && "cursor-not-allowed opacity-50",
          )}
        />
        {/* Focus indicator */}
        <AnimatePresence>
          {isFocused && (
            <motion.div
              {...fadeIn}
              className="pointer-events-none absolute inset-0 rounded-b-2xl ring-1 ring-inset ring-[var(--aurora-2)]/30"
            />
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}
