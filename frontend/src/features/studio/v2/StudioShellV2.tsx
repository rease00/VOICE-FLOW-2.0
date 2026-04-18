"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/ui/Button";
import { fadeIn } from "@/ui/motion";
import { EditorPane } from "./EditorPane";
import { VoicePickerDrawer } from "./VoicePickerDrawer";
import { GenerationDock } from "./GenerationDock";
import { useStudioGenerate } from "../hooks/useStudioGenerate";
import { VOICES } from "../../../../constants";
import type { StudioEditorMode, GenerationSettings } from "../../../../types";

const DRAFT_KEY = "vf:studio-v2:draft";

export function StudioShellV2() {
  /* ── script state ──────────────────────────── */
  const [text, setText] = useState("");
  const [editorMode, setEditorMode] = useState<StudioEditorMode>("raw");

  /* ── voice state ───────────────────────────── */
  const [selectedVoiceId, setSelectedVoiceId] = useState(VOICES[0]?.id ?? "");
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

  /* ── generation state ──────────────────────── */
  const [status, setStatus] = useState<"idle" | "generating" | "playing" | "paused" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const { synthesize } = useStudioGenerate();

  /* ── draft persistence ─────────────────────── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setText(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch { /* ignore */ }
  }, [text]);

  /* ── generate handler ──────────────────────── */
  const handleGenerate = useCallback(async () => {
    if (!text.trim() || status === "generating") return;

    setStatus("generating");
    setProgress(0);
    setAudioUrl(null);
    setErrorMessage(undefined);

    const controller = new AbortController();
    abortRef.current = controller;

    // Simulated progress
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 8, 90));
    }, 600);

    const voice = VOICES.find((v) => v.id === selectedVoiceId) ?? VOICES[0]!;
    const settings: GenerationSettings = {
      voiceId: voice!.id,
      speed: 1,
      pitch: 'Medium',
      language: voice!.accent,
      engine: 'PRIME',
      helperProvider: 'GEMINI',
    };

    try {
      const result = await synthesize(text, settings, 'speech', controller.signal);
      clearInterval(interval);
      setProgress(100);

      if (result instanceof Blob) {
        setAudioUrl(URL.createObjectURL(result));
      } else if (result instanceof ArrayBuffer) {
        setAudioUrl(URL.createObjectURL(new Blob([result], { type: "audio/mp3" })));
      } else if (typeof result === "object" && result !== null && "audioUrl" in result) {
        setAudioUrl((result as { audioUrl: string }).audioUrl);
      }
      setStatus("idle");
    } catch (err: unknown) {
      clearInterval(interval);
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
      } else {
        setStatus("error");
        setErrorMessage((err as Error).message || "Generation failed");
      }
    }
  }, [text, selectedVoiceId, editorMode, status, synthesize]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setProgress(0);
  }, []);

  const handlePlay = useCallback(() => setStatus("playing"), []);
  const handlePause = useCallback(() => setStatus("paused"), []);

  const handleDownload = useCallback(() => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "voiceflow-studio.mp3";
    a.click();
  }, [audioUrl]);

  const handlePreviewVoice = useCallback((voiceId: string) => {
    setPreviewingVoiceId(voiceId);
    setTimeout(() => setPreviewingVoiceId(null), 2000);
  }, []);

  return (
    <motion.main
      {...fadeIn}
      className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-6 px-4 py-6 pb-24 md:px-8"
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
          <Button variant="secondary" size="md" onClick={() => {}}>
            Save draft
          </Button>
          <Button
            variant="aurora"
            size="md"
            onClick={handleGenerate}
            disabled={!text.trim() || status === "generating"}
            loading={status === "generating"}
          >
            Generate
          </Button>
        </div>
      </header>

      <section
        aria-label="Workspace"
        className="grid gap-6 lg:grid-cols-[1fr_320px]"
      >
        <EditorPane
          text={text}
          onChange={setText}
          editorMode={editorMode}
          onEditorModeChange={setEditorMode}
        />
        <VoicePickerDrawer
          selectedVoiceId={selectedVoiceId}
          onSelectVoice={setSelectedVoiceId}
          previewingVoiceId={previewingVoiceId}
          onPreviewVoice={handlePreviewVoice}
        />
      </section>

      <GenerationDock
        status={status}
        progress={progress}
        audioUrl={audioUrl}
        queueLength={0}
        onGenerate={handleGenerate}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onDownload={handleDownload}
        onOpenQueue={() => {}}
        disabled={!text.trim()}
        errorMessage={errorMessage}
      />
    </motion.main>
  );
}
