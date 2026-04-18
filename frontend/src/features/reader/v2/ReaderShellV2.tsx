"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { GlassPanel } from "@/ui/GlassPanel";
import { fadeIn, spring } from "@/ui/motion";

/**
 * Reader v2 shell — premium player + import vault gate (paid-only).
 * Gated by `feature_flags/ui_v2.surfaces.reader`.
 *
 * Pieces (TODO):
 *   - <TextCanvas /> — paginated reader with chapter rail
 *   - <PlayerDock /> — fixed-bottom player (this stub)
 *   - <NowPlaying /> — full-screen "Spotify-style" view
 *   - <NotesPanel /> — side annotations
 *   - <AmbianceMixer /> — background ambience layering
 *   - <ImportVault /> — paid-tier import library w/ 90-day frozen retention
 */
export function ReaderShellV2({ paid = false }: { paid?: boolean }) {
  const [playing, setPlaying] = useState(false);

  return (
    <motion.main
      {...fadeIn}
      className="relative mx-auto flex min-h-screen w-full max-w-[960px] flex-col gap-6 px-4 pb-32 pt-6 md:px-8"
    >
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[var(--text-h1)] font-semibold tracking-[var(--tracking-tight)] text-[var(--vf-color-text)]">
            Reader
          </h1>
          <p className="text-sm text-[var(--vf-color-text-muted)]">
            Listen to anything you import — books, articles, scripts.
          </p>
        </div>
        {paid ? (
          <Button variant="secondary" size="md">
            Import library
          </Button>
        ) : (
          <Button variant="aurora" size="md">
            Upgrade to import
          </Button>
        )}
      </header>

      <Card elevation={1} className="min-h-[420px]">
        <article className="prose prose-invert max-w-none text-[var(--vf-color-text)]">
          <p className="text-[var(--vf-color-text-muted)]">
            Text canvas placeholder — Phase 6.3
          </p>
        </article>
      </Card>

      {!paid && (
        <Card elevation={2} glow className="text-center">
          <h2 className="aurora-text text-xl font-semibold">Unlock import</h2>
          <p className="mt-1 text-sm text-[var(--vf-color-text-muted)]">
            Bring your own EPUB, PDF, web pages and Markdown. Frozen vault keeps
            them safe for 90 days if your subscription lapses.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="aurora" size="md">
              See plans
            </Button>
            <Button variant="ghost" size="md">
              Learn more
            </Button>
          </div>
        </Card>
      )}

      <GlassPanel
        intensity={3}
        anchor="bottom"
        role="region"
        aria-label="Player dock"
        className="fixed inset-x-4 bottom-4 z-[var(--z-dock)] mx-auto max-w-[928px] px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((p) => !p)}
            whileTap={{ scale: 0.94 }}
            transition={spring.press}
            className="aurora-bg flex h-12 w-12 items-center justify-center rounded-full text-white shadow-[0_8px_20px_rgba(124,92,255,0.45)]"
          >
            {playing ? (
              <span className="block h-3 w-3 border-x-[3px] border-current" />
            ) : (
              <span className="ml-0.5 block h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-current" />
            )}
          </motion.button>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium text-[var(--vf-color-text)]">
              Untitled chapter
            </span>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,currentColor_12%,transparent)]">
              <motion.div
                className="h-full aurora-bg"
                initial={{ width: "0%" }}
                animate={{ width: playing ? "32%" : "0%" }}
                transition={spring.layout}
              />
            </div>
          </div>
          <span className="text-xs tabular-nums text-[var(--vf-color-text-muted)]">
            00:00
          </span>
        </div>
      </GlassPanel>
    </motion.main>
  );
}
