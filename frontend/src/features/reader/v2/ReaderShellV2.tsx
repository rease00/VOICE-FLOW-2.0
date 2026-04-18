"use client";

import { motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { fadeIn } from "@/ui/motion";
import { FileText, Globe, BookOpen, Upload } from "lucide-react";
import { TextCanvas } from "./TextCanvas";
import { PlayerDock } from "./PlayerDock";
import { useStudioGenerate } from "../../studio/hooks/useStudioGenerate";
import { VOICES } from "../../../../constants";
import type { GenerationSettings } from "../../../../types";

const DEMO_TEXT = `Welcome to the VoiceFlow Reader.

This is a demonstration of paragraph-level AI narration. Each paragraph can be read aloud by any of our 30 premium Gemini voices.

Tap any paragraph to jump to it. The active paragraph is highlighted with an aurora ring so you always know where you are.

Use the controls below to adjust font size, playback speed, and volume. You can also skip forward or backward between paragraphs using the transport buttons.

Import your own books, articles, and scripts to listen on the go. Supported formats include plain text, Markdown, and EPUB files.`;

export function ReaderShellV2({ paid = false }: { paid?: boolean }) {
  const [content, setContent] = useState(DEMO_TEXT);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [fontSize, setFontSize] = useState(18);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);

  const { synthesize } = useStudioGenerate();

  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  /* ── paragraph playback ────────────────────── */
  const handleParagraphClick = useCallback(
    async (index: number) => {
      setActiveIndex(index);
      const para = paragraphs[index];
      if (!para) return;

      setSynthesizing(true);
      const voice = VOICES[0];
      if (!voice) return;
      const settings: GenerationSettings = {
        voiceId: voice.id,
        speed: 1,
        pitch: 'Medium',
        language: voice.accent,
        engine: 'PRIME',
        helperProvider: 'GEMINI',
      };

      try {
        const result = await synthesize(para, settings, 'speech', undefined);
        if (result instanceof Blob) {
          setAudioUrl(URL.createObjectURL(result));
        } else if (result instanceof ArrayBuffer) {
          setAudioUrl(URL.createObjectURL(new Blob([result], { type: "audio/mp3" })));
        } else if (typeof result === "object" && result !== null && "audioUrl" in result) {
          setAudioUrl((result as { audioUrl: string }).audioUrl);
        }
      } catch {
        /* ignore */
      } finally {
        setSynthesizing(false);
      }
    },
    [paragraphs, synthesize],
  );

  /* ── skip forward/back ─────────────────────── */
  const handleSkipForward = useCallback(() => {
    const next = Math.min(activeIndex + 1, paragraphs.length - 1);
    handleParagraphClick(next);
  }, [activeIndex, paragraphs.length, handleParagraphClick]);

  const handleSkipBack = useCallback(() => {
    const prev = Math.max(activeIndex - 1, 0);
    handleParagraphClick(prev);
  }, [activeIndex, handleParagraphClick]);

  /* ── file import ───────────────────────────── */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFileImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setContent(reader.result);
          setActiveIndex(-1);
          setAudioUrl(null);
        }
      };
      reader.readAsText(file);
    },
    [],
  );

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
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.epub"
              onChange={handleFileImport}
              className="hidden"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              Import
            </Button>
          </>
        ) : (
          <Button variant="aurora" size="md">
            Upgrade to import
          </Button>
        )}
      </header>

      <TextCanvas
        content={content}
        activeIndex={activeIndex}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        onParagraphClick={handleParagraphClick}
      />

      {paid && (
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-[var(--vf-color-text-muted)] transition hover:border-white/10 hover:bg-white/5"
          >
            <FileText className="h-5 w-5" />
            <span className="text-xs font-medium">File</span>
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-[var(--vf-color-text-muted)] transition hover:border-white/10 hover:bg-white/5"
          >
            <BookOpen className="h-5 w-5" />
            <span className="text-xs font-medium">EPUB</span>
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-[var(--vf-color-text-muted)] transition hover:border-white/10 hover:bg-white/5"
          >
            <Globe className="h-5 w-5" />
            <span className="text-xs font-medium">URL</span>
          </button>
        </div>
      )}

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

      <PlayerDock
        audioUrl={audioUrl}
        synthesizing={synthesizing}
        onSkipForward={handleSkipForward}
        onSkipBack={handleSkipBack}
      />
    </motion.main>
  );
}
