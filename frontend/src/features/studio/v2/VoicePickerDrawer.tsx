"use client";

import { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { sheetUp, spring } from "@/ui/motion";
import { Mic2, Play, Pause, Search, X, Loader2 } from "lucide-react";
import type { VoiceOption } from "../../../../types";
import { VOICES } from "../../../../constants";

interface VoicePickerDrawerProps {
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  previewingVoiceId: string | null;
  onPreviewVoice: (voiceId: string) => void;
}

type GenderFilter = "All" | "Male" | "Female";

export function VoicePickerDrawer({
  selectedVoiceId,
  onSelectVoice,
  previewingVoiceId,
  onPreviewVoice,
}: VoicePickerDrawerProps) {
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("All");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    let result = VOICES;
    if (genderFilter !== "All") {
      result = result.filter((v) => v.gender === genderFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.accent.toLowerCase().includes(q) ||
          (v.country || "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [search, genderFilter]);

  const selectedVoice = VOICES.find((v) => v.id === selectedVoiceId);

  return (
    <Card elevation={1} className="flex min-h-[420px] flex-col overflow-hidden">
      <div className="flex items-center justify-between px-1 pb-3">
        <h2 className="text-sm font-medium uppercase tracking-[var(--tracking-wide)] text-[var(--vf-color-text-muted)]">
          <Mic2 className="mr-1.5 inline h-4 w-4" />
          Cast
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse" : "Browse all"}
        </Button>
      </div>

      {/* Selected voice preview */}
      {selectedVoice && (
        <div className="mb-3 rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold",
                selectedVoice.gender === "Female"
                  ? "bg-pink-500/20 text-pink-300"
                  : "bg-blue-500/20 text-blue-300",
              )}
            >
              {selectedVoice.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--vf-color-text)]">
                {selectedVoice.name}
              </p>
              <p className="text-xs text-[var(--vf-color-text-muted)]">
                {selectedVoice.accent} · {selectedVoice.country}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onPreviewVoice(selectedVoice.id)}
              className="rounded-full p-2 text-[var(--vf-color-text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--vf-color-text)]"
            >
              {previewingVoiceId === selectedVoice.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Search + filter */}
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--vf-color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voices…"
            className="h-8 w-full rounded-lg bg-white/5 pl-8 pr-8 text-xs text-[var(--vf-color-text)] placeholder:text-[var(--vf-color-text-muted)]/50 outline-none focus:ring-1 focus:ring-[var(--aurora-2)]/40"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Gender filter tabs */}
      <div className="mb-3 flex gap-1">
        {(["All", "Male", "Female"] as GenderFilter[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGenderFilter(g)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              genderFilter === g
                ? "bg-white/10 text-[var(--vf-color-text)]"
                : "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text)]",
            )}
          >
            {g}
          </button>
        ))}
        <span className="ml-auto text-xs tabular-nums text-[var(--vf-color-text-muted)]">
          {filtered.length} voices
        </span>
      </div>

      {/* Voice list */}
      <div className={cn("flex-1 space-y-1 overflow-y-auto", expanded ? "max-h-[600px]" : "max-h-[200px]")}>
        {filtered.map((voice) => {
          const isSelected = voice.id === selectedVoiceId;
          const isPreviewing = previewingVoiceId === voice.id;

          return (
            <motion.button
              key={voice.id}
              type="button"
              onClick={() => onSelectVoice(voice.id)}
              whileTap={{ scale: 0.98 }}
              transition={spring.press}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors",
                isSelected
                  ? "bg-[var(--aurora-2)]/15 text-[var(--vf-color-text)]"
                  : "text-[var(--vf-color-text-muted)] hover:bg-white/5 hover:text-[var(--vf-color-text)]",
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  voice.gender === "Female"
                    ? "bg-pink-500/15 text-pink-300"
                    : "bg-blue-500/15 text-blue-300",
                )}
              >
                {voice.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{voice.name}</p>
                <p className="truncate text-[10px] opacity-60">
                  {voice.accent}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreviewVoice(voice.id);
                }}
                className="shrink-0 rounded-full p-1 opacity-60 hover:opacity-100"
              >
                {isPreviewing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </button>
            </motion.button>
          );
        })}
      </div>
    </Card>
  );
}
