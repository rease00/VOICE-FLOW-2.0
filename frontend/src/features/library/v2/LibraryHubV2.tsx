"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Clock, Mic, Plus, Trash2 } from "lucide-react";
import { Button } from "@/ui/Button";
import { GlassPanel } from "@/ui/GlassPanel";
import { cn } from "@/ui/cn";
import { fadeIn } from "@/ui/motion";
import {
  clearStudioDraft,
  loadStudioDraft,
} from "../../../../services/studioDraftService";
import { APP_ROUTE_PATHS } from "../../../app/navigation";

/* ── helpers ─────────────────────────────────── */

interface StudioDraftEntry {
  text: string;
  meta?: Record<string, unknown>;
  savedAt: number;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ── main component ──────────────────────────── */

export function LibraryHubV2() {
  const router = useRouter();
  // undefined = still loading, null = no draft
  const [draft, setDraft] = useState<StudioDraftEntry | null | undefined>(undefined);

  useEffect(() => {
    loadStudioDraft().then(setDraft);
  }, []);

  const handleClearDraft = useCallback(async () => {
    await clearStudioDraft();
    setDraft(null);
  }, []);

  return (
    <motion.main
      {...fadeIn}
      className="mx-auto w-full max-w-[1440px] px-4 py-8 md:px-8"
    >
      {/* Header */}
      <header className="mb-8">
        <h1 className="aurora-text text-[var(--text-h1)] font-semibold tracking-[var(--tracking-tight)]">
          Library
        </h1>
        <p className="text-sm text-[var(--vf-color-text-muted)]">
          Your content, sessions, and studio drafts.
        </p>
      </header>

      {/* Quick actions */}
      <div className="mb-10 flex flex-wrap gap-3">
        <Button variant="aurora" size="md" onClick={() => router.push(APP_ROUTE_PATHS.studio)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Studio project
        </Button>
        <Button variant="secondary" size="md" onClick={() => router.push('/app/reader-v2')}>
          <BookOpen className="mr-1.5 h-4 w-4" />
          Open Reader
        </Button>
      </div>

      {/* Studio draft card */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--vf-color-text-muted)]">
          Studio draft
        </h2>

        {draft === undefined ? (
          /* loading skeleton */
          <GlassPanel className="h-[76px] animate-pulse rounded-2xl" />
        ) : draft ? (
          <GlassPanel className="flex items-start justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 line-clamp-2 text-sm leading-relaxed text-[var(--vf-color-text-primary)]">
                {draft.text.slice(0, 240) || "(empty)"}
              </p>
              <div className="flex items-center gap-3 text-xs text-[var(--vf-color-text-muted)]">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {relativeTime(draft.savedAt)}
                </span>
                <span>{wordCount(draft.text).toLocaleString()} words</span>
                {typeof draft.meta?.voiceId === 'string' && (
                  <span className="flex items-center gap-1 truncate">
                    <Mic className="h-3 w-3" />
                    {draft.meta.voiceId}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearDraft}
                aria-label="Clear draft"
              >
                <Trash2 className="h-4 w-4 text-[var(--vf-color-text-muted)]" />
              </Button>
              <Button variant="aurora" size="sm" onClick={() => router.push(APP_ROUTE_PATHS.studio)}>
                Open
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </GlassPanel>
        ) : (
          <GlassPanel className="flex items-center gap-3 p-5 text-sm text-[var(--vf-color-text-muted)]">
            <Mic className="h-4 w-4 shrink-0 opacity-60" />
            <span>
              No saved draft yet. Open Studio and use &ldquo;Save draft&rdquo; to preserve your
              work.
            </span>
          </GlassPanel>
        )}
      </section>

      {/* Browse section */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--vf-color-text-muted)]">
          Browse
        </h2>
        <GlassPanel className="p-5">
          <BrowseTabs />
        </GlassPanel>
      </section>
    </motion.main>
  );
}

/* ── Browse tabs ─────────────────────────────── */

type BrowseTab = "novels" | "comics" | "favorites" | "imported";

const BROWSE_TABS: { id: BrowseTab; label: string }[] = [
  { id: "novels", label: "Novels" },
  { id: "comics", label: "Comics" },
  { id: "favorites", label: "Favorites" },
  { id: "imported", label: "Imported" },
];

function BrowseTabs() {
  const [active, setActive] = useState<BrowseTab>("novels");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Browse categories"
        className="mb-4 flex gap-0 border-b border-white/10"
      >
        {BROWSE_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]",
              active === t.id
                ? "-mb-px border-b-2 border-[var(--aurora-1)] text-[var(--vf-color-text-primary)]"
                : "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <BrowsePlaceholder tab={active} />
      </div>
    </div>
  );
}

function BrowsePlaceholder({ tab }: { tab: BrowseTab }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-sm text-[var(--vf-color-text-muted)]">
      <BookOpen className="h-8 w-8 opacity-30" />
      <p className="font-medium capitalize">{tab}</p>
      <p className="text-xs opacity-70">Full content browser coming in Phase 1.</p>
    </div>
  );
}
