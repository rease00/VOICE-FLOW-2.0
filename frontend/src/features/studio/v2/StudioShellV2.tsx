"use client";

import { motion } from "framer-motion";
import { Card } from "@/ui/Card";
import { GlassPanel } from "@/ui/GlassPanel";
import { Button } from "@/ui/Button";
import { fadeIn } from "@/ui/motion";

/**
 * Studio v2 shell — gated by `feature_flags/ui_v2.surfaces.studio`.
 * Render this from the existing studio route only when the flag is true.
 *
 * Pieces (TODO, tracked in /memories/session/plan.md):
 *   - <EditorPane /> — Monaco-backed VoiceFlow Script editor
 *   - <VoicePickerDrawer /> — searchable cast manager
 *   - <CastManager /> — multi-speaker assignment
 *   - <GenerationDock /> — bottom dock for synth queue
 *   - <HistoryPanel /> — versioned takes
 */
export function StudioShellV2() {
  return (
    <motion.main
      {...fadeIn}
      className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8"
    >
      <header className="flex items-center justify-between">
        <div>
          <h1 className="aurora-text text-[var(--text-h1)] font-semibold tracking-[var(--tracking-tight)]">
            Studio
          </h1>
          <p className="text-sm text-[var(--vf-color-text-muted)]">
            Premium multi-speaker AI voice composition.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md">
            Save draft
          </Button>
          <Button variant="aurora" size="md">
            Generate
          </Button>
        </div>
      </header>

      <section
        aria-label="Workspace"
        className="grid gap-6 lg:grid-cols-[1fr_320px]"
      >
        <Card elevation={2} className="min-h-[420px]">
          <div className="flex h-full items-center justify-center text-[var(--vf-color-text-muted)]">
            Editor pane (Monaco) — Phase 6.2
          </div>
        </Card>
        <Card elevation={1} className="min-h-[420px]">
          <h2 className="text-sm font-medium uppercase tracking-[var(--tracking-wide)] text-[var(--vf-color-text-muted)]">
            Cast
          </h2>
          <div className="mt-3 text-sm text-[var(--vf-color-text-muted)]">
            VoicePickerDrawer placeholder — Phase 6.2
          </div>
        </Card>
      </section>

      <GlassPanel
        intensity={3}
        anchor="bottom"
        role="region"
        aria-label="Generation dock"
        className="fixed inset-x-4 bottom-4 z-[var(--z-dock)] mx-auto max-w-[1376px] p-3"
      >
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-[var(--vf-color-text-muted)]">Idle</span>
          <Button variant="ghost" size="sm">
            Open queue
          </Button>
        </div>
      </GlassPanel>
    </motion.main>
  );
}
