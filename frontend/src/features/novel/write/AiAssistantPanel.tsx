'use client';
import React, { useState, useCallback, useRef } from 'react';
import { Wand2, Sparkles, ArrowRight, Loader2, RotateCcw, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import type { GenerationSettings } from '../../../../types';

type AiAction = 'continue' | 'rewrite' | 'expand' | 'summarize' | 'dialogue' | 'describe';

interface AiAssistantPanelProps {
  selectedText: string;
  fullText: string;
  settings: GenerationSettings;
  onApply: (text: string) => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const AI_ACTIONS: Array<{
  id: AiAction;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: 'continue', label: 'Continue Writing', shortLabel: 'Continue', description: 'AI continues from where you left off', icon: <ArrowRight size={12} /> },
  { id: 'rewrite', label: 'Rewrite Selection', shortLabel: 'Rewrite', description: 'Rewrite the selected text with improved prose', icon: <RotateCcw size={12} /> },
  { id: 'expand', label: 'Expand Selection', shortLabel: 'Expand', description: 'Expand the selected text with more detail', icon: <Sparkles size={12} /> },
  { id: 'summarize', label: 'Summarize', shortLabel: 'Summarize', description: 'Create a concise summary of the text', icon: <ChevronDown size={12} /> },
  { id: 'dialogue', label: 'Write Dialogue', shortLabel: 'Dialogue', description: 'Generate dialogue for the current scene', icon: <Wand2 size={12} /> },
  { id: 'describe', label: 'Describe Scene', shortLabel: 'Describe', description: 'Generate vivid scene description', icon: <Sparkles size={12} /> },
];

const buildPrompt = (action: AiAction, selectedText: string, fullText: string): string => {
  const context = fullText.slice(-2000);
  const hasSelection = selectedText.trim().length > 0;

  switch (action) {
    case 'continue':
      return `You are a skilled novelist. Continue writing the following story naturally, maintaining the same tone, style, and voice. Write 2-3 paragraphs that flow seamlessly from where the text ends.\n\n${context}`;
    case 'rewrite':
      return hasSelection
        ? `You are a skilled prose editor. Rewrite the following text to be more vivid, engaging, and well-crafted while preserving the meaning and intent:\n\n${selectedText}`
        : `Rewrite the ending of this passage to be more impactful:\n\n${context}`;
    case 'expand':
      return hasSelection
        ? `You are a skilled novelist. Expand the following text with more sensory details, inner thoughts, and vivid description while preserving the core narrative:\n\n${selectedText}`
        : `Expand the ending of this passage with more detail:\n\n${context}`;
    case 'summarize':
      return `Summarize the following text in 2-3 concise sentences, capturing the key events and emotions:\n\n${context}`;
    case 'dialogue':
      return `You are a skilled dialogue writer. Based on the current scene context, write natural, character-driven dialogue (3-5 exchanges) that advances the story:\n\nContext:\n${context}`;
    case 'describe':
      return `You are a master of vivid description. Write a rich, sensory scene description (1-2 paragraphs) that establishes atmosphere and setting based on this context:\n\n${context}`;
  }
};

export const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({
  selectedText,
  fullText,
  settings,
  onApply,
  onToast,
}) => {
  const [result, setResult] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastAction, setLastAction] = useState<AiAction | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const handleAction = useCallback(async (action: AiAction) => {
    if (isGenerating) return;
    setIsGenerating(true);
    setLastAction(action);
    setResult(null);

    try {
      const { generateTextContent } = await import('../../../../services/geminiService');
      const prompt = buildPrompt(action, selectedText, fullText);
      const generated = await generateTextContent(prompt, fullText, settings);
      setResult(generated);
      setIsExpanded(true);
    } catch (err) {
      onToast('AI generation failed. Check your API key in Settings.', 'error');
      setResult(null);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, selectedText, fullText, settings, onToast]);

  const handleCopy = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(
      () => onToast('Copied to clipboard', 'success'),
      () => onToast('Failed to copy', 'error')
    );
  }, [result, onToast]);

  const handleApply = useCallback(() => {
    if (!result) return;
    onApply(result);
    onToast('Applied AI suggestion', 'success');
  }, [result, onApply, onToast]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">AI Assistant</h4>
        {selectedText.trim() && (
          <span className="text-[10px] text-blue-300 bg-blue-500/15 px-2 py-0.5 rounded border border-blue-500/25">
            {selectedText.trim().split(/\s+/).length} words selected
          </span>
        )}
      </div>

      {/* Action grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {AI_ACTIONS.map(action => (
          <button
            key={action.id}
            onClick={() => handleAction(action.id)}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-white/5 hover:border-white/10 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title={action.description}
          >
            {isGenerating && lastAction === action.id ? (
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              action.icon
            )}
            {action.shortLabel}
          </button>
        ))}
      </div>

      {/* Result */}
      {result !== null && (
        <div className="border border-white/10 rounded-xl overflow-hidden">
          <button
            onClick={() => setIsExpanded(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/50 hover:bg-slate-800/70 transition-colors"
          >
            <span className="text-[11px] font-medium text-slate-300">
              {lastAction && AI_ACTIONS.find(a => a.id === lastAction)?.label} Result
            </span>
            {isExpanded ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
          </button>

          {isExpanded && (
            <div ref={resultRef} className="px-3 py-3 space-y-3">
              <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-900/60 rounded-lg p-3 max-h-48 overflow-y-auto border border-white/5">
                {result}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleApply}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  <ArrowRight size={10} />
                  Apply
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-white/10"
                >
                  <Copy size={10} />
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
