import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Plus, Slash, Sparkles, Trash2 } from 'lucide-react';
import { ScriptBlock, ScriptBlockType, StudioEditorMode } from '../../types';
import {
  createEmptyDialogueBlock,
  createEmptyDirectionBlock,
  createEmptySfxBlock,
  normalizeScriptBlocks,
  parseScriptToBlocks,
  serializeBlocksToScript,
} from '../../services/scriptBlocks';

interface BlockScriptEditorProps {
  value: string;
  mode: StudioEditorMode;
  emotions: string[];
  speakerSuggestions?: string[];
  onChange: (nextValue: string) => void;
  onModeChange: (mode: StudioEditorMode) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const clampIndex = (index: number, length: number): number => (
  Math.max(0, Math.min(Math.max(0, length - 1), index))
);

const createBlockByType = (type: ScriptBlockType): ScriptBlock => {
  if (type === 'sfx') return createEmptySfxBlock();
  if (type === 'direction') return createEmptyDirectionBlock();
  return createEmptyDialogueBlock();
};

const DEVANAGARI_REGEX = /[\u0900-\u097F]/u;

export const BlockScriptEditor: React.FC<BlockScriptEditorProps> = ({
  value,
  mode,
  emotions,
  speakerSuggestions = [],
  onChange,
  onModeChange,
  placeholder = 'Write your script here...',
  className = '',
  disabled = false,
}) => {
  const [blocks, setBlocks] = useState<ScriptBlock[]>(() => {
    const parsed = parseScriptToBlocks(value);
    return parsed.length > 0 ? parsed : [createEmptyDialogueBlock()];
  });
  const [activeBlockId, setActiveBlockId] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const lastSerializedRef = useRef<string>('');
  const hasDevanagari = DEVANAGARI_REGEX.test(String(value || ''));

  const emotionOptions = useMemo(() => {
    const dedup = new Set<string>();
    const out: string[] = [];
    emotions.forEach((item) => {
      const token = String(item || '').trim();
      if (!token) return;
      const key = token.toLowerCase();
      if (dedup.has(key)) return;
      dedup.add(key);
      out.push(token);
    });
    if (!dedup.has('neutral')) out.unshift('Neutral');
    return out;
  }, [emotions]);

  useEffect(() => {
    const normalizedIncoming = serializeBlocksToScript(parseScriptToBlocks(value));
    if (normalizedIncoming === lastSerializedRef.current) return;
    const parsed = parseScriptToBlocks(value);
    setBlocks(parsed.length > 0 ? parsed : [createEmptyDialogueBlock()]);
  }, [value]);

  const commitBlocks = (nextBlocks: ScriptBlock[]) => {
    const normalized = normalizeScriptBlocks(nextBlocks);
    setBlocks(normalized);
    const nextScript = serializeBlocksToScript(normalized);
    lastSerializedRef.current = nextScript;
    onChange(nextScript);
  };

  const updateBlock = (blockId: string, patch: Partial<ScriptBlock>) => {
    const next = blocks.map((row) => {
      if (row.id !== blockId) return row;
      return { ...row, ...patch };
    });
    commitBlocks(next);
  };

  const updateCueTags = (blockId: string, cueText: string) => {
    const cueTags = cueText
      .split(',')
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const next = blocks.map((row) => {
      if (row.id !== blockId) return row;
      return {
        ...row,
        emotion: {
          ...row.emotion,
          cueTags,
        },
      };
    });
    commitBlocks(next);
  };

  const addBlock = (type: ScriptBlockType, index?: number) => {
    const nextBlock = createBlockByType(type);
    const insertionIndex = typeof index === 'number'
      ? clampIndex(index, blocks.length + 1)
      : blocks.length;
    const next = [...blocks];
    next.splice(insertionIndex, 0, nextBlock);
    setActiveBlockId(nextBlock.id);
    setMenuOpen(false);
    commitBlocks(next);
  };

  const removeBlock = (blockId: string) => {
    const filtered = blocks.filter((row) => row.id !== blockId);
    if (filtered.length === 0) {
      const fallback = createEmptyDialogueBlock();
      setActiveBlockId(fallback.id);
      commitBlocks([fallback]);
      return;
    }
    setActiveBlockId(filtered[0]?.id || '');
    commitBlocks(filtered);
  };

  const moveBlock = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) return;
    const safeSource = clampIndex(sourceIndex, blocks.length);
    const safeTarget = clampIndex(targetIndex, blocks.length);
    const next = [...blocks];
    const [moved] = next.splice(safeSource, 1);
    next.splice(safeTarget, 0, moved);
    commitBlocks(next);
  };

  const commandInsertIndex = useMemo(() => {
    if (!activeBlockId) return blocks.length;
    const index = blocks.findIndex((row) => row.id === activeBlockId);
    return index >= 0 ? index + 1 : blocks.length;
  }, [activeBlockId, blocks]);

  return (
    <div className={`vf-block-editor relative flex h-full min-h-0 flex-col ${className}`}>
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/60 px-4 py-2">
        <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => onModeChange('blocks')}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
              mode === 'blocks' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Blocks
          </button>
          <button
            type="button"
            onClick={() => onModeChange('raw')}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
              mode === 'raw' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Raw
          </button>
        </div>

        {mode === 'blocks' && (
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-100"
              title="Add block (+)"
            >
              <Plus size={12} className="inline mr-1" />
              Add
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-100"
              title="Quick insert (/)"
            >
              <Slash size={12} className="inline mr-1" />
              /
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
                {([
                  { type: 'dialogue', label: 'Dialogue' },
                  { type: 'sfx', label: 'SFX' },
                  { type: 'direction', label: 'Direction' },
                ] as Array<{ type: ScriptBlockType; label: string }>).map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => addBlock(option.type, commandInsertIndex)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-gray-700 hover:bg-gray-100"
                  >
                    <span>{option.label}</span>
                    {option.type === 'dialogue' && <Sparkles size={12} className="text-indigo-500" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {mode === 'raw' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={`vf-studio-raw-editor custom-scrollbar flex-1 resize-none border-0 bg-transparent px-5 py-4 text-base outline-none ${
            hasDevanagari ? 'vf-devanagari' : ''
          }`}
        />
      ) : (
        <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {blocks.map((block, index) => {
            const cueValue = (block.emotion?.cueTags || []).join(', ');
            return (
              <div
                key={block.id}
                draggable={!disabled}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex === null) return;
                  moveBlock(dragIndex, index);
                  setDragIndex(null);
                }}
                onClick={() => setActiveBlockId(block.id)}
                className={`vf-script-block rounded-2xl border p-3 transition-all ${
                  activeBlockId === block.id ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <GripVertical size={14} className="text-gray-400" />
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600">
                      {block.type}
                    </span>
                    <span className="text-[10px] font-semibold text-gray-400">#{index + 1}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => addBlock('dialogue', index + 1)}
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-100"
                    >
                      + below
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      className="rounded-md border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {block.type === 'dialogue' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                      <input
                        value={block.speaker}
                        onChange={(event) => updateBlock(block.id, { speaker: event.target.value })}
                        list="vf-studio-speakers"
                        placeholder="Speaker"
                        className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-xs outline-none focus:border-indigo-400"
                      />
                      <select
                        value={block.emotion?.primaryEmotion || 'Neutral'}
                        onChange={(event) => updateBlock(block.id, {
                          emotion: {
                            ...(block.emotion || { primaryEmotion: 'Neutral', cueTags: [] }),
                            primaryEmotion: event.target.value,
                          },
                        })}
                        className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-xs outline-none focus:border-indigo-400"
                      >
                        {emotionOptions.map((emotion) => (
                          <option key={`${block.id}_${emotion}`} value={emotion}>
                            {emotion}
                          </option>
                        ))}
                      </select>
                      <input
                        value={cueValue}
                        onChange={(event) => updateCueTags(block.id, event.target.value)}
                        placeholder="Cue tags (comma separated)"
                        className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-xs outline-none focus:border-indigo-400"
                      />
                    </div>
                    <textarea
                      value={block.text}
                      onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                      placeholder={placeholder}
                      className={`custom-scrollbar min-h-[72px] w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 ${
                        DEVANAGARI_REGEX.test(block.text || '') ? 'vf-devanagari' : ''
                      }`}
                    />
                  </div>
                )}

                {block.type === 'sfx' && (
                  <input
                    value={block.text}
                    onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                    placeholder="SFX description"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-indigo-400"
                  />
                )}

                {block.type === 'direction' && (
                  <textarea
                    value={block.text}
                    onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                    placeholder="Direction note"
                    className="w-full min-h-[60px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-indigo-400"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {speakerSuggestions.length > 0 && (
        <datalist id="vf-studio-speakers">
          {speakerSuggestions.map((speaker) => (
            <option key={speaker} value={speaker} />
          ))}
        </datalist>
      )}
    </div>
  );
};

