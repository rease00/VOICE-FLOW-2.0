import React from 'react';
import { FileAudio, Globe, Type } from 'lucide-react';
import { LanguageOption } from '../types';

interface DubbingTranslateBarProps {
  targetLang: string;
  isBusy: boolean;
  hasDubScript: boolean;
  hasVideoFile: boolean;
  languages: LanguageOption[];
  onTargetLang: (lang: string) => void;
  onTranslateText: () => void;
  onTranslateAudio: () => void;
}

export const DubbingTranslateBar: React.FC<DubbingTranslateBarProps> = ({
  targetLang,
  isBusy,
  hasDubScript,
  hasVideoFile,
  languages,
  onTargetLang,
  onTranslateText,
  onTranslateAudio,
}) => {
  return (
    <div className="px-4 py-2.5 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 backdrop-blur-sm border-b border-gray-100 relative z-10">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-[12rem]">
          <Globe size={14} className="text-blue-600 shrink-0" />
          <span className="text-[10px] font-black uppercase tracking-wide text-blue-700">Target</span>
          <div className="flex items-center gap-1 bg-white rounded-lg border border-blue-100 px-1 py-0.5 shadow-sm">
            <select
              value={targetLang}
              onChange={(e) => onTargetLang(e.target.value)}
              className="h-8 min-w-[8.75rem] px-2 text-[11px] font-semibold bg-transparent outline-none text-gray-700 hover:text-gray-900 cursor-pointer"
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.name}>{lang.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
        <button
          onClick={onTranslateText}
          disabled={isBusy || !hasDubScript}
          className="h-8 text-[11px] font-bold text-gray-700 hover:bg-gray-100 px-2.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55"
          title="Translate existing text in editor"
        >
          <Type size={12} />
          Text
        </button>
        <button
          onClick={onTranslateAudio}
          disabled={!hasVideoFile || isBusy}
          className="h-8 text-[11px] font-bold text-blue-700 hover:bg-blue-100 px-2.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55"
          title="Translate audio from video file"
        >
          <FileAudio size={12} />
          Audio
        </button>
        </div>
      </div>
    </div>
  );
};

