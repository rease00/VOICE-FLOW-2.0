'use client';
import React, { useState } from 'react';
import { Plus, Lock, Unlock, Trash2, Search } from 'lucide-react';
import type { MemoryEntryKind, MemoryEntry, ChapterMemorySummary } from '../../../../types';
import { useMemoryLedger } from '../hooks/useMemoryLedger';

type FilterTab = 'character' | 'place';

const EntryRow: React.FC<{
  entry: MemoryEntry;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<MemoryEntry, 'sourceName' | 'adaptedName'>>) => void;
}> = ({ entry, onToggleLock, onDelete, onUpdate }) => {
  const [editing, setEditing] = useState<{ source?: string; adapted?: string } | null>(null);

  return (
    <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td className="py-1.5 px-2 text-xs text-slate-300">
        {editing !== null ? (
          <input
            autoFocus
            className="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-blue-500"
            defaultValue={editing.source ?? entry.sourceName}
            onBlur={(e) => {
              onUpdate(entry.id, { sourceName: e.target.value });
              setEditing(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(null);
            }}
          />
        ) : (
          <span
            className="cursor-text hover:text-white transition-colors"
            onClick={() => setEditing({ source: entry.sourceName })}
            title="Click to edit"
          >
            {entry.sourceName || <em className="opacity-40">—</em>}
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 text-xs text-blue-300">
        <span
          className="cursor-text hover:text-blue-100 transition-colors"
          onClick={() => setEditing({ adapted: entry.adaptedName })}
          title="Click to edit"
        >
          {editing !== null && editing.adapted !== undefined ? (
            <input
              autoFocus
              className="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-blue-500"
              defaultValue={entry.adaptedName}
              onBlur={(e) => {
                onUpdate(entry.id, { adaptedName: e.target.value });
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            entry.adaptedName || <em className="opacity-40">—</em>
          )}
        </span>
      </td>
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => onToggleLock(entry.id)}
            className={`p-1 rounded transition-colors ${
              entry.locked
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title={entry.locked ? 'Unlock entry' : 'Lock entry (auto-update disabled)'}
          >
            {entry.locked ? <Lock size={11} /> : <Unlock size={11} />}
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors"
            title="Remove entry"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </td>
    </tr>
  );
};

const AddEntryRow: React.FC<{ kind: MemoryEntryKind; onAdd: (kind: MemoryEntryKind, src: string, adapted: string) => void }> = ({
  kind,
  onAdd,
}) => {
  const [source, setSource] = useState('');
  const [adapted, setAdapted] = useState('');

  const submit = () => {
    if (!source.trim()) return;
    onAdd(kind, source, adapted);
    setSource('');
    setAdapted('');
  };

  return (
    <tr className="border-t border-white/10">
      <td className="py-2 px-2">
        <input
          placeholder="Source name"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="py-2 px-2">
        <input
          placeholder="Adapted name"
          value={adapted}
          onChange={(e) => setAdapted(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="py-2 px-2">
        <button
          onClick={submit}
          disabled={!source.trim()}
          className="p-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
          title="Add entry"
        >
          <Plus size={12} />
        </button>
      </td>
    </tr>
  );
};

const ChapterSummaryCard: React.FC<{ summary: ChapterMemorySummary }> = ({ summary }) => (
  <div className="bg-slate-800/60 rounded-lg p-3 space-y-2">
    <p className="text-xs font-semibold text-slate-300">{summary.chapterTitle}</p>
    <p className="text-xs text-slate-400 leading-relaxed">{summary.summary}</p>
    {summary.newCharacters.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {summary.newCharacters.map((c) => (
          <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">{c}</span>
        ))}
      </div>
    )}
    {summary.newPlaces.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {summary.newPlaces.map((p) => (
          <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">{p}</span>
        ))}
      </div>
    )}
  </div>
);

export const MemoryLedger: React.FC = () => {
  const { ledger, chapterSummaries, addEntry, updateEntry, removeEntry, toggleLock } = useMemoryLedger();
  const [filterTab, setFilterTab] = useState<FilterTab>('character');
  const [search, setSearch] = useState('');
  const [showSummaries, setShowSummaries] = useState(false);

  const entries = filterTab === 'character' ? ledger.characters : ledger.places;
  const filtered = search.trim()
    ? entries.filter(
        (e) =>
          e.sourceName.toLowerCase().includes(search.toLowerCase()) ||
          e.adaptedName.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs */}
      <div className="flex items-center gap-1">
        {(['character', 'place'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filterTab === tab
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab === 'character' ? 'Characters' : 'Places'}
            <span className="ml-1 opacity-60">
              ({tab === 'character' ? ledger.characters.length : ledger.places.length})
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-slate-800/80 border border-slate-700 rounded px-2 py-1.5 pl-7 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="py-1 px-2 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Source</th>
              <th className="py-1 px-2 text-left text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Adapted</th>
              <th className="py-1 px-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-4 text-center text-xs text-slate-500">
                  {search ? 'No matching entries' : 'No entries yet — adapt a chapter to fill this table'}
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onToggleLock={toggleLock}
                  onDelete={removeEntry}
                  onUpdate={updateEntry}
                />
              ))
            )}
            <AddEntryRow kind={filterTab} onAdd={addEntry} />
          </tbody>
        </table>
      </div>

      {/* Chapter Summaries */}
      {chapterSummaries.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowSummaries((v) => !v)}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors mb-2"
          >
            {showSummaries ? '▾' : '▸'} Chapter Summaries ({chapterSummaries.length})
          </button>
          {showSummaries && (
            <div className="flex flex-col gap-2">
              {chapterSummaries.map((s) => (
                <ChapterSummaryCard key={s.chapterId} summary={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
