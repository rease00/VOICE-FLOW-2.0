import React from 'react';
import { Globe, Languages } from 'lucide-react';
import { LanguageOption } from '../types';

interface StudioTranslateBarProps {
  targetLang: string;
  isBusy: boolean;
  languages: LanguageOption[];
  onTargetLang: (lang: string) => void;
  onTranslate: () => void;
}

export const StudioTranslateBar: React.FC<StudioTranslateBarProps> = ({
  targetLang,
  isBusy,
  languages,
  onTargetLang,
  onTranslate,
}) => {
  return (
    <div className="px-4 py-2 bg-gradient-to-r from-indigo-50/80 to-sky-50/80 backdrop-blur-sm border-t border-gray-100 flex items-center justify-between gap-2 relative z-10">
      <div className="flex items-center gap-2 overflow-hidden">
        <Languages size={14} className="text-indigo-600 shrink-0" />
        <span className="text-xs font-bold text-gray-600 hidden sm:inline">Translate:</span>
        <div className="flex items-center gap-1 bg-white rounded-lg border border-indigo-100 p-0.5 shadow-sm overflow-x-auto no-scrollbar">
          <button
            onClick={() => onTargetLang('Hinglish')}
            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'Hinglish' ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-md shadow-orange-200' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Hinglish
          </button>
          <button
            onClick={() => onTargetLang('English')}
            className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'English' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            English
          </button>
          <button
            onClick={() => onTargetLang('Hindi')}
            className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'Hindi' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            Hindi
          </button>
          <select
            value={targetLang}
            onChange={(e) => onTargetLang(e.target.value)}
            className="px-2 py-1 text-[10px] font-bold bg-transparent outline-none text-gray-500 hover:text-gray-800 cursor-pointer max-w-[96px]"
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.name}>{lang.name}</option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={onTranslate}
        disabled={isBusy}
        className="text-xs font-bold text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55"
      >
        <Globe size={12} />
        Run Translate
      </button>
    </div>
  );
};

