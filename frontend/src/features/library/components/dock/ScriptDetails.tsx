'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  BookOpen,
  X,
  FileText,
  Sparkles,
  PlayCircle,
  Wand2,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Layers,
  RefreshCw,
  Pencil,
  Eye,
  Cloud,
} from 'lucide-react';
import { splitIntoSentenceChunks } from '../../services/ttsUtils';
import type { ReaderScriptPlaybackSource } from '../../model/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'raw' | 'ai' | 'play';
type AiSubTab = 'script' | 'director';

interface ScriptDetailsProps {
  isCompact?: boolean;
  currentText?: string;
  chapterTitle?: string;
  initialAiScript?: string;
  onAiScriptChange?: (value: string) => void;
  preferredPlaybackSource?: ReaderScriptPlaybackSource;
  onPreferredPlaybackSourceChange?: (value: ReaderScriptPlaybackSource) => void;
  cachedAudioReady?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectLanguage(text: string): string {
  if (!text) return 'Unknown';
  const sample = text.slice(0, 600);

  const ranges: [RegExp, string][] = [
    [/[\u0600-\u06FF]/g, 'Arabic'],
    [/[\u0900-\u097F]/g, 'Hindi'],
    [/[\u0980-\u09FF]/g, 'Bengali'],
    [/[\u4E00-\u9FFF]/g, 'Chinese'],
    [/[\u3040-\u309F\u30A0-\u30FF]/g, 'Japanese'],
    [/[\uAC00-\uD7AF]/g, 'Korean'],
    [/[\u0400-\u04FF]/g, 'Russian'],
    [/[\u0E00-\u0E7F]/g, 'Thai'],
  ];

  for (const [regex, lang] of ranges) {
    if ((sample.match(regex) || []).length > 10) return lang;
  }

  if (/\b(the|and|is|was|in|of|to|that)\b/i.test(sample)) return 'English';
  if (/\b(le|la|les|de|des|est|une?|que)\b/i.test(sample)) return 'French';
  if (/\b(el|la|los|las|de|en|que|es|un|una)\b/i.test(sample)) return 'Spanish';
  if (/\b(der|die|das|und|ist|ein|eine|den)\b/i.test(sample)) return 'German';
  if (/\b(il|la|di|che|un|una|è|per|del)\b/i.test(sample)) return 'Italian';
  if (/\b(o|a|os|as|de|em|que|um|uma|do)\b/i.test(sample)) return 'Portuguese';

  return 'English';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScriptDetails({
  isCompact = false,
  currentText = '',
  chapterTitle = 'Current chapter',
  initialAiScript = '',
  onAiScriptChange,
  preferredPlaybackSource = 'raw',
  onPreferredPlaybackSourceChange,
  cachedAudioReady = false,
}: ScriptDetailsProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('play');

  // AI Script
  const [aiScript, setAiScript] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSubTab, setAiSubTab] = useState<AiSubTab>('script');
  const [directorNotes, setDirectorNotes] = useState('');
  const [isEditingAi, setIsEditingAi] = useState(false);
  const [editedAiScript, setEditedAiScript] = useState('');

  // Play Script
  const [chunkSize, setChunkSize] = useState(500);
  const [showChunkConfig, setShowChunkConfig] = useState(false);
  const [pregenCount, setPregenCount] = useState(5);
  const [copied, setCopied] = useState<number | null>(null);

  const prevTextRef = useRef(currentText);
  const autoGenRef = useRef(false);

  // Reset AI script when chapter text changes
  useEffect(() => {
    prevTextRef.current = currentText;
    setAiScript(initialAiScript);
    setAiError(null);
    setIsEditingAi(false);
    setEditedAiScript(initialAiScript);
    autoGenRef.current = Boolean(initialAiScript);
  }, [currentText, initialAiScript]);

  const detectedLanguage = useMemo(() => detectLanguage(currentText), [currentText]);

  const playbackScriptText = useMemo(() => {
    if (preferredPlaybackSource === 'ai' && aiScript.trim()) {
      return aiScript;
    }
    return currentText;
  }, [aiScript, currentText, preferredPlaybackSource]);

  const chunks = useMemo(
    () => splitIntoSentenceChunks(playbackScriptText, chunkSize),
    [chunkSize, playbackScriptText]
  );

  const displayAiScript = isEditingAi ? editedAiScript : aiScript;

  const generateAiScript = useCallback(async () => {
    if (!currentText) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentText,
          directorNotes: directorNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Generation failed');
      }
      const data = (await res.json()) as { annotatedText: string };
      setAiScript(data.annotatedText);
      setEditedAiScript(data.annotatedText);
      setIsEditingAi(false);
      onAiScriptChange?.(data.annotatedText);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAiLoading(false);
    }
  }, [currentText, directorNotes, onAiScriptChange]);

  // Auto-generate AI script when text is available
  useEffect(() => {
    if (currentText && !aiScript && !aiLoading && !aiError && !autoGenRef.current) {
      autoGenRef.current = true;
      generateAiScript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentText]);

  const copyChunk = useCallback((index: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(index);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  if (isCompact) {
    return (
      <button
        onClick={() => setShowPanel(true)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-200 hover:bg-[#1a366d]"
      >
        <BookOpen size={14} />
        Script
      </button>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'raw', label: 'Raw', icon: <FileText size={14} /> },
    { id: 'ai', label: 'AI Script', icon: <Sparkles size={14} /> },
    { id: 'play', label: 'Play Script', icon: <PlayCircle size={14} /> },
  ];

  const playbackSourceOptions: Array<{
    id: ReaderScriptPlaybackSource;
    label: string;
    icon: React.ReactNode;
    visible: boolean;
    description: string;
  }> = [
    {
      id: 'raw',
      label: 'Raw',
      icon: <FileText size={12} />,
      visible: true,
      description: 'Generate and play directly from the raw chapter text.',
    },
    {
      id: 'ai',
      label: 'AI Script',
      icon: <Sparkles size={12} />,
      visible: true,
      description: aiScript
        ? 'Generate and play using the AI-directed playback script.'
        : aiLoading
          ? 'AI script is generating. Raw playback will be used until it is ready.'
          : 'No AI script is ready yet. Raw playback will be used until one exists.',
    },
    {
      id: 'cached',
      label: 'CDN Audio',
      icon: <Cloud size={12} />,
      visible: cachedAudioReady,
      description: 'Play the pre-generated signed chapter audio from the CDN.',
    },
  ];

  const visiblePlaybackSourceOptions = playbackSourceOptions.filter((option) => option.visible);
  const selectedPlaybackSource = visiblePlaybackSourceOptions.find((option) => option.id === preferredPlaybackSource)
    ?? visiblePlaybackSourceOptions[0];

  return (
    <>
      <div className="space-y-2 rounded-xl border border-[#2f4f83] bg-[#0d1c3f] p-3">
        <h3 className="text-sm font-semibold text-slate-100">Script</h3>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {chapterTitle}
        </p>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg bg-[#0a1530] p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#1a366d] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[120px]">
          {activeTab === 'raw' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1a366d]/60 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                  <Layers size={10} />
                  {detectedLanguage}
                </span>
                <span className="text-[10px] text-slate-500">
                  {currentText.length.toLocaleString()} chars
                </span>
              </div>
              <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                {currentText || 'No chapter text loaded yet.'}
              </p>
              <button
                onClick={() => setShowPanel(true)}
                className="w-full rounded-md bg-[#10244c] px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1a366d]"
              >
                Open full script
              </button>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-2">
              <div className="flex gap-1">
                <button
                  onClick={() => setAiSubTab('script')}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    aiSubTab === 'script'
                      ? 'bg-purple-500/20 text-purple-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles size={11} />
                  Generated
                </button>
                <button
                  onClick={() => setAiSubTab('director')}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    aiSubTab === 'director'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Wand2 size={11} />
                  Director
                </button>
              </div>

              {aiSubTab === 'script' && (
                <div className="space-y-2">
                  {!aiScript && !aiLoading && (
                    <div className="flex flex-col items-center gap-2 py-4">
                      <Sparkles size={24} className="text-purple-400/50" />
                      <p className="text-center text-xs text-slate-400">
                        Generate an annotated script with speaker tags, emotions, pace, and cues.
                      </p>
                      <button
                        onClick={generateAiScript}
                        disabled={!currentText}
                        className="flex items-center gap-1.5 rounded-lg bg-purple-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-600 disabled:opacity-40"
                      >
                        <Sparkles size={12} />
                        Generate AI Script
                      </button>
                    </div>
                  )}
                  {aiLoading && (
                    <div className="flex flex-col items-center gap-2 py-6">
                      <Loader2 size={20} className="animate-spin text-purple-400" />
                      <p className="text-xs text-slate-400">Generating annotated script…</p>
                    </div>
                  )}
                  {aiError && (
                    <div className="rounded-md bg-red-900/30 p-2 text-xs text-red-300">
                      {aiError}
                    </div>
                  )}
                  {aiScript && !aiLoading && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">AI Annotated</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              if (isEditingAi) {
                                setAiScript(editedAiScript);
                                onAiScriptChange?.(editedAiScript);
                              }
                              setIsEditingAi(!isEditingAi);
                            }}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-[#1a366d] hover:text-slate-200"
                            title={isEditingAi ? 'Save edits' : 'Edit script'}
                          >
                            {isEditingAi ? <Check size={10} /> : <Pencil size={10} />}
                            {isEditingAi ? 'Save' : 'Edit'}
                          </button>
                          <button
                            onClick={generateAiScript}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-[#1a366d] hover:text-slate-200"
                            title="Regenerate"
                          >
                            <RefreshCw size={10} />
                          </button>
                        </div>
                      </div>
                      {isEditingAi ? (
                        <textarea
                          value={editedAiScript}
                          onChange={(e) => setEditedAiScript(e.target.value)}
                          className="no-scrollbar w-full rounded-md border border-[#2f4f83] bg-[#0a1530] p-2 text-xs leading-relaxed text-slate-300 focus:border-purple-500 focus:outline-none"
                          rows={8}
                          title="Edit AI script"
                        />
                      ) : (
                        <p className="line-clamp-8 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                          {displayAiScript}
                        </p>
                      )}
                      <button
                        onClick={() => setShowPanel(true)}
                        className="w-full rounded-md bg-[#10244c] px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1a366d]"
                      >
                        <Eye size={12} className="mr-1 inline" />
                        View full AI script
                      </button>
                    </>
                  )}
                </div>
              )}

              {aiSubTab === 'director' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-400">
                    Provide direction for how the AI should annotate the script.
                    E.g. &quot;Make the narrator sound ominous&quot; or &quot;Add dramatic pauses before reveals&quot;.
                  </p>
                  <textarea
                    value={directorNotes}
                    onChange={(e) => setDirectorNotes(e.target.value)}
                    placeholder="e.g. The narrator should sound warm and grandfatherly…"
                    className="no-scrollbar w-full rounded-md border border-[#2f4f83] bg-[#0a1530] p-2 text-xs leading-relaxed text-slate-300 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                    rows={4}
                  />
                  <button
                    onClick={() => {
                      setAiSubTab('script');
                      generateAiScript();
                    }}
                    disabled={!currentText || aiLoading}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-40"
                  >
                    <Wand2 size={12} />
                    {aiScript ? 'Re-generate with Notes' : 'Generate with Notes'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'play' && (
            <div className="space-y-2">
              <div className="rounded-md border border-[#2f4f83]/50 bg-[#0a1530] p-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    Playback Source
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {selectedPlaybackSource?.label || 'Raw'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {visiblePlaybackSourceOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => onPreferredPlaybackSourceChange?.(option.id)}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        preferredPlaybackSource === option.id
                          ? 'bg-[#1a366d] text-white'
                          : 'text-slate-400 hover:bg-[#10244c] hover:text-slate-200'
                      }`}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                  {selectedPlaybackSource?.description}
                </p>
              </div>

              <button
                onClick={() => setShowChunkConfig(!showChunkConfig)}
                className="flex w-full items-center justify-between rounded-md bg-[#0a1530] px-2 py-1.5 text-xs text-slate-300 hover:bg-[#10244c]"
              >
                <span className="flex items-center gap-1.5">
                  <SlidersHorizontal size={12} />
                  Chunk Settings
                </span>
                {showChunkConfig ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showChunkConfig && (
                <div className="space-y-3 rounded-md border border-[#2f4f83]/50 bg-[#0a1530] p-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-[10px] font-medium text-slate-400">
                        Chunk Size
                      </label>
                      <span className="text-[10px] font-mono text-blue-300">
                        {chunkSize} chars
                      </span>
                    </div>
                    <input
                      type="range"
                      min={500}
                      max={4500}
                      step={100}
                      value={chunkSize}
                      onChange={(e) => setChunkSize(Number(e.target.value))}
                      className="w-full accent-blue-500"
                      title="Chunk size"
                    />
                    <div className="flex justify-between text-[9px] text-slate-600">
                      <span>500</span>
                      <span>4500</span>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-[10px] font-medium text-slate-400">
                        Pre-generation Queue
                      </label>
                      <span className="text-[10px] font-mono text-blue-300">
                        {pregenCount} chunks
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={pregenCount}
                      onChange={(e) => setPregenCount(Number(e.target.value))}
                      className="w-full accent-blue-500"
                      title="Pre-generation queue count"
                    />
                    <div className="flex justify-between text-[9px] text-slate-600">
                      <span>1</span>
                      <span>5</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-slate-400">
                  {chunks.length} chunk{chunks.length !== 1 ? 's' : ''} total
                </span>
                <span className="text-[10px] text-slate-500">
                  {preferredPlaybackSource === 'cached'
                    ? 'CDN ready'
                    : `Queue: ${Math.min(pregenCount, chunks.length)}`}
                </span>
              </div>

              <div className="no-scrollbar max-h-[200px] space-y-1.5 overflow-y-auto">
                {chunks.slice(0, Math.min(pregenCount, chunks.length)).map((chunk, i) => (
                  <div
                    key={i}
                    className="group rounded-md border border-[#2f4f83]/40 bg-[#0a1530] p-2 transition-colors hover:border-[#2f4f83]"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/20 text-[9px] font-bold text-blue-300">
                          {i + 1}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">
                          {chunk.length} chars
                        </span>
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300">
                          {preferredPlaybackSource === 'cached' ? 'CDN' : 'Ready'}
                        </span>
                        <button
                          onClick={() => copyChunk(i, chunk)}
                          className="rounded p-0.5 text-slate-500 opacity-0 transition-opacity hover:text-slate-200 group-hover:opacity-100"
                          title="Copy chunk text"
                        >
                          {copied === i ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
                      {chunk}
                    </p>
                  </div>
                ))}

                {chunks.length > pregenCount && (
                  <div className="flex items-center justify-center gap-1 rounded-md border border-dashed border-[#2f4f83]/30 p-2 text-[10px] text-slate-500">
                    <Layers size={10} />
                    +{chunks.length - pregenCount} more chunk
                    {chunks.length - pregenCount !== 1 ? 's' : ''} queued
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-screen modal */}
      {showPanel && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4">
          <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-[#2f4f83] bg-[#0d1c3f] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#35588f] px-4 py-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-slate-100">{chapterTitle}</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#1a366d]/60 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                  <Layers size={10} />
                  {detectedLanguage}
                </span>
              </div>
              <button
                onClick={() => setShowPanel(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-[#1a366d]"
                aria-label="Close script panel"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-1 border-b border-[#35588f]/50 px-4 py-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-[#1a366d] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
              {activeTab === 'raw' && (
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">
                  {currentText || 'No chapter text loaded yet.'}
                </p>
              )}

              {activeTab === 'ai' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAiSubTab('script')}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        aiSubTab === 'script'
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Sparkles size={12} />
                      Generated Script
                    </button>
                    <button
                      onClick={() => setAiSubTab('director')}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        aiSubTab === 'director'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Wand2 size={12} />
                      AI Director
                    </button>
                  </div>

                  {aiSubTab === 'script' && (
                    <div className="space-y-3">
                      {!aiScript && !aiLoading && (
                        <div className="flex flex-col items-center gap-3 py-10">
                          <Sparkles size={32} className="text-purple-400/40" />
                          <p className="text-center text-sm text-slate-400">
                            Generate an annotated script with speaker tags, emotions, pace, and dramatic cues.
                          </p>
                          <button
                            onClick={generateAiScript}
                            disabled={!currentText}
                            className="flex items-center gap-2 rounded-lg bg-purple-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-40"
                          >
                            <Sparkles size={14} />
                            Generate AI Script
                          </button>
                        </div>
                      )}
                      {aiLoading && (
                        <div className="flex flex-col items-center gap-3 py-12">
                          <Loader2 size={24} className="animate-spin text-purple-400" />
                          <p className="text-sm text-slate-400">
                            Generating annotated script…
                          </p>
                        </div>
                      )}
                      {aiError && (
                        <div className="rounded-md bg-red-900/30 p-3 text-sm text-red-300">
                          {aiError}
                        </div>
                      )}
                      {aiScript && !aiLoading && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">AI Annotated Script</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  if (isEditingAi) {
                                    setAiScript(editedAiScript);
                                    onAiScriptChange?.(editedAiScript);
                                  }
                                  setIsEditingAi(!isEditingAi);
                                }}
                                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-[#1a366d] hover:text-slate-200"
                              >
                                {isEditingAi ? <Check size={12} /> : <Pencil size={12} />}
                                {isEditingAi ? 'Save' : 'Edit'}
                              </button>
                              <button
                                onClick={generateAiScript}
                                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-[#1a366d] hover:text-slate-200"
                                title="Regenerate"
                              >
                                <RefreshCw size={12} />
                                Regenerate
                              </button>
                            </div>
                          </div>
                          {isEditingAi ? (
                            <textarea
                              value={editedAiScript}
                              onChange={(e) => setEditedAiScript(e.target.value)}
                              className="no-scrollbar w-full rounded-md border border-[#2f4f83] bg-[#0a1530] p-3 text-sm leading-7 text-slate-300 focus:border-purple-500 focus:outline-none"
                              rows={20}
                              title="Edit AI script"
                            />
                          ) : (
                            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">
                              {displayAiScript}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {aiSubTab === 'director' && (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-400">
                        Guide the AI on how to annotate the script. Add character voices,
                        moods, pacing instructions, or any creative direction.
                      </p>
                      <textarea
                        value={directorNotes}
                        onChange={(e) => setDirectorNotes(e.target.value)}
                        placeholder="e.g. Make the narrator sound ominous. Add dramatic pauses before plot twists. The villain speaks slowly and deliberately…"
                        className="no-scrollbar w-full rounded-md border border-[#2f4f83] bg-[#0a1530] p-3 text-sm leading-relaxed text-slate-300 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                        rows={6}
                      />
                      <button
                        onClick={() => {
                          setAiSubTab('script');
                          generateAiScript();
                        }}
                        disabled={!currentText || aiLoading}
                        className="flex items-center gap-2 rounded-lg bg-amber-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40"
                      >
                        <Wand2 size={14} />
                        {aiScript ? 'Re-generate with Director Notes' : 'Generate with Director Notes'}
                      </button>
                    </div>
                  )}
                </div>
              )}

          {activeTab === 'play' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-[#2f4f83]/50 bg-[#0a1530] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Playback Source
                      </span>
                      <span className="text-xs text-slate-500">
                        {selectedPlaybackSource?.label || 'Raw'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {visiblePlaybackSourceOptions.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => onPreferredPlaybackSourceChange?.(option.id)}
                          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            preferredPlaybackSource === option.id
                              ? 'bg-[#1a366d] text-white'
                              : 'text-slate-400 hover:bg-[#10244c] hover:text-slate-200'
                          }`}
                        >
                          {option.icon}
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      {selectedPlaybackSource?.description}
                    </p>
                  </div>

                  <div className="rounded-lg border border-[#2f4f83]/50 bg-[#0a1530] p-3">
                    <button
                      onClick={() => setShowChunkConfig(!showChunkConfig)}
                      className="flex w-full items-center justify-between text-xs font-medium text-slate-300"
                    >
                      <span className="flex items-center gap-1.5">
                        <SlidersHorizontal size={13} />
                        Chunk Configuration
                      </span>
                      {showChunkConfig ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>

                    {showChunkConfig && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-xs text-slate-400">Chunk Size</label>
                            <span className="font-mono text-xs text-blue-300">{chunkSize} chars</span>
                          </div>
                          <input
                            type="range"
                            min={500}
                            max={4500}
                            step={100}
                            value={chunkSize}
                            onChange={(e) => setChunkSize(Number(e.target.value))}
                            className="w-full accent-blue-500"
                            title="Chunk size"
                          />
                          <div className="flex justify-between text-[10px] text-slate-600">
                            <span>500</span>
                            <span>4500</span>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <label className="text-xs text-slate-400">Pre-generation Queue</label>
                            <span className="font-mono text-xs text-blue-300">{pregenCount} chunks</span>
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={5}
                            step={1}
                            value={pregenCount}
                            onChange={(e) => setPregenCount(Number(e.target.value))}
                            className="w-full accent-blue-500"
                            title="Pre-generation queue count"
                          />
                          <div className="flex justify-between text-[10px] text-slate-600">
                            <span>1</span>
                            <span>5</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-md bg-[#0a1530] px-3 py-2">
                    <span className="text-xs font-medium text-slate-300">
                      {chunks.length} chunk{chunks.length !== 1 ? 's' : ''} total
                    </span>
                    <span className="text-xs text-slate-500">
                      {preferredPlaybackSource === 'cached'
                        ? 'CDN ready'
                        : `Pre-gen queue: ${Math.min(pregenCount, chunks.length)}`}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {chunks.map((chunk, i) => {
                      const isQueued = i < pregenCount;
                      return (
                        <div
                          key={i}
                          className={`group rounded-lg border p-3 transition-colors ${
                            isQueued
                              ? 'border-[#2f4f83]/60 bg-[#0a1530]'
                              : 'border-[#2f4f83]/20 bg-[#0a1530]/50'
                          }`}
                        >
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="flex items-center gap-2">
                              <span
                                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                                  isQueued
                                    ? 'bg-blue-500/20 text-blue-300'
                                    : 'bg-slate-700/40 text-slate-500'
                                }`}
                              >
                                {i + 1}
                              </span>
                              <span className="text-xs text-slate-400">
                                {chunk.length} chars
                              </span>
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  isQueued
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-slate-700/30 text-slate-500'
                                }`}
                              >
                                {preferredPlaybackSource === 'cached'
                                  ? 'CDN'
                                  : isQueued ? 'Ready' : 'Queued'}
                              </span>
                              <button
                                onClick={() => copyChunk(i, chunk)}
                                className="rounded p-1 text-slate-500 hover:text-slate-200"
                                title="Copy chunk text"
                              >
                                {copied === i ? (
                                  <Check size={12} className="text-emerald-400" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            </div>
                          </div>
                          <p
                            className={`whitespace-pre-wrap text-xs leading-relaxed ${
                              isQueued ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {chunk}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
