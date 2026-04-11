'use client';
import React, { useState } from 'react';
import { X, Wand2, BookMarked, Clock, RefreshCw, Upload } from 'lucide-react';
import type { GenerationSettings } from '../../../../types';
import { MemoryLedger } from './MemoryLedger';
import { VersionHistory } from './VersionHistory';
import { useChapterEditor } from '../hooks/useChapterEditor';
import { useAdaptation } from '../hooks/useAdaptation';
import { useDriveSync } from '../hooks/useDriveSync';
import { useLocalFolderSync } from '../hooks/useLocalFolderSync';
import { useNovelEditor } from '../contexts/NovelEditorContext';
import { PublishingPanel } from '../../publishing/components/PublishingPanel';

type PanelTab = 'adapt' | 'memory' | 'versions' | 'sync' | 'publish';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface ToolsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GenerationSettings;
  onToast: ToastFn;
  onRequestAdapt: (text: string, updateAdapted: (t: string) => void) => Promise<void>;
  isAdapting: boolean;
}

const TAB_ICONS: Record<PanelTab, React.ReactNode> = {
  adapt: <Wand2 size={14} />,
  memory: <BookMarked size={14} />,
  versions: <Clock size={14} />,
  sync: <RefreshCw size={14} />,
  publish: <Upload size={14} />,
};

export const ToolsPanel: React.FC<ToolsPanelProps> = ({
  isOpen,
  onClose,
  settings,
  onToast,
  onRequestAdapt,
  isAdapting,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('adapt');

  const { selectedProject, chapters, projects, chaptersByProjectId: allChaptersByProjectId, memoryLedgerByProjectId, chapterSummariesByProjectId, chapterVersionsByProjectId, selectedProjectId, setProjects, setChaptersByProjectId: setAllChapters } = useNovelEditor();
  const { versions, updateAdaptedOutput } = useChapterEditor();
  const {
    targetLang, targetCulture, isBatchRunning, batchMessage,
    setTargetLang, setTargetCulture, adaptSingle, runBatch, cancelBatch,
  } = useAdaptation(settings, onToast);

  const { chapterText } = useChapterEditor();

  const {
    driveState, isConnecting, isUploading, isDownloading,
    connectDrive, uploadToDrive, downloadFromDrive,
  } = useDriveSync(onToast, false);

  const {
    boundFolderName, isBinding, syncStatus, isSupported,
    bindFolder, syncProject,
  } = useLocalFolderSync(onToast);

  const { revertToVersion } = useChapterEditor();

  return (
    <aside
      className={`shrink-0 flex flex-col border-l border-white/10 bg-slate-900/80 backdrop-blur-xl transition-all duration-300 ${
        isOpen ? 'w-80 opacity-100' : 'w-0 opacity-0 overflow-hidden'
      }`}
    >
      {isOpen && (
        <>
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <h3 className="text-sm font-semibold text-white">Tools</h3>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10 shrink-0 flex-wrap">
            {(Object.keys(TAB_ICONS) as PanelTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors capitalize ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {TAB_ICONS[tab]}
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto min-h-0 p-4">
            {activeTab === 'adapt' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Target Language</label>
                  <input
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    placeholder="e.g. Hinglish, Spanish, Arabic"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Cultural Context <span className="opacity-50">(optional)</span></label>
                  <input
                    value={targetCulture}
                    onChange={(e) => setTargetCulture(e.target.value)}
                    placeholder="e.g. Bollywood style, modern Mumbai"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={() => adaptSingle(chapterText, updateAdaptedOutput)}
                  disabled={isAdapting || !chapterText.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm transition-colors"
                >
                  {isAdapting ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Wand2 size={14} />
                  )}
                  {isAdapting ? 'Adapting…' : 'Adapt Chapter'}
                </button>
                <div className="border-t border-white/10 pt-3">
                  <p className="text-xs text-slate-400 mb-2">Batch Adapt All</p>
                  {isBatchRunning ? (
                    <div className="space-y-2">
                      <p className="text-xs text-blue-300">{batchMessage}</p>
                      <button
                        onClick={cancelBatch}
                        className="w-full py-2 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                      >
                        Cancel Batch
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={runBatch}
                      disabled={isAdapting}
                      className="w-full py-2 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-white/10 transition-colors"
                    >
                      Run Batch Adaptation
                    </button>
                  )}
                  {batchMessage && !isBatchRunning && (
                    <p className="text-xs text-slate-400 mt-1">{batchMessage}</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'memory' && <MemoryLedger />}

            {activeTab === 'versions' && (
              <VersionHistory versions={versions} onRevert={revertToVersion} />
            )}

            {activeTab === 'sync' && (
              <div className="space-y-5">
                {/* Drive sync */}
                <div>
                  <p className="text-xs font-semibold text-slate-300 mb-2">Google Drive</p>
                  <div className={`text-xs px-2.5 py-1.5 rounded-lg mb-3 ${
                    driveState.status === 'connected'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : driveState.status === 'error'
                      ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                      : 'bg-slate-800 text-slate-400 border border-white/10'
                  }`}>
                    {driveState.status === 'connected' ? '● Connected' : driveState.status === 'error' ? '● Connection error' : '○ Not connected'}
                  </div>
                  {driveState.status !== 'connected' ? (
                    <button
                      onClick={connectDrive}
                      disabled={isConnecting}
                      className="w-full py-2 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-white/10 transition-colors"
                    >
                      {isConnecting ? 'Connecting…' : 'Connect Drive'}
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => uploadToDrive(projects, allChaptersByProjectId)}
                        disabled={isUploading || isDownloading}
                        className="flex-1 py-1.5 text-xs rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white transition-colors"
                      >
                        {isUploading ? 'Uploading…' : '↑ Upload'}
                      </button>
                      <button
                        onClick={async () => {
                          const result = await downloadFromDrive();
                          if (result) {
                            setProjects(result.projects);
                            const mapped: typeof allChaptersByProjectId = {};
                            for (const [pid, chs] of Object.entries(result.chaptersByProject)) {
                              mapped[pid] = chs.map((c) => ({ ...c, adaptedText: '' }));
                            }
                            setAllChapters(mapped);
                          }
                        }}
                        disabled={isUploading || isDownloading}
                        className="flex-1 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-white/10 transition-colors"
                      >
                        {isDownloading ? 'Downloading…' : '↓ Download'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Local folder sync */}
                <div>
                  <p className="text-xs font-semibold text-slate-300 mb-2">Local Folder</p>
                  {!isSupported ? (
                    <p className="text-xs text-slate-500">File System API not supported in this browser.</p>
                  ) : (
                    <>
                      {boundFolderName && (
                        <p className="text-xs text-slate-400 mb-2 truncate">
                          Bound: <span className="text-slate-200">{boundFolderName}</span>
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={bindFolder}
                          disabled={isBinding}
                          className="flex-1 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-white/10 transition-colors"
                        >
                          {isBinding ? 'Binding…' : boundFolderName ? 'Change Folder' : 'Bind Folder'}
                        </button>
                        {boundFolderName && selectedProject && (
                          <button
                            onClick={() => syncProject(
                              selectedProject.name,
                              chapters,
                              memoryLedgerByProjectId[selectedProjectId] ?? { characters: [], places: [] },
                              chapterSummariesByProjectId[selectedProjectId] ?? [],
                              chapterVersionsByProjectId[selectedProjectId] ?? {},
                            )}
                            className="flex-1 py-1.5 text-xs rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white transition-colors"
                          >
                            Sync Now
                          </button>
                        )}
                      </div>
                      {syncStatus && (
                        <p className="text-xs text-slate-400 mt-1.5">{syncStatus}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'publish' && selectedProject && (
              <PublishingPanel
                novelProjectId={selectedProject.id}
                novelTitle={selectedProject.name}
                chapters={chapters.map((c) => ({ id: c.id, title: c.title, text: c.text }))}
                onToast={onToast}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
};
