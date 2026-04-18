import React, { useState } from 'react';
import { Lock, Unlock, Gem } from 'lucide-react';

interface ChapterTokenGateProps {
  chapterTitle: string;
  tokenCost: number;
  userTokenBalance: number;
  onUnlock: () => void;
}

export const ChapterTokenGate: React.FC<ChapterTokenGateProps> = ({
  chapterTitle,
  tokenCost,
  userTokenBalance,
  onUnlock,
}) => {
  const [isUnlocking, setIsUnlocking] = useState(false);
  const canAfford = userTokenBalance >= tokenCost;

  const handleUnlock = () => {
    if (!canAfford) return;
    setIsUnlocking(true);
    // Mimic API delay
    setTimeout(() => {
        setIsUnlocking(false);
        onUnlock();
    }, 800);
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-slate-900 border border-slate-800 rounded-2xl max-w-md mx-auto text-center mt-10 shadow-2xl relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-amber-500/10 blur-[50px] pointer-events-none" />

      <div className="relative z-10">
        <div className="w-16 h-16 bg-slate-950 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-500/30">
          <Lock className="text-amber-400" size={28} />
        </div>
        
        <h2 className="text-xl font-bold text-white mb-2">Premium Chapter</h2>
        <p className="text-sm text-slate-400 mb-6 px-4">
          "{chapterTitle}" is locked by the author. You need VF Tokens to continue reading.
        </p>

        <div className="bg-slate-950 rounded-xl p-4 w-full mb-6 border border-slate-800 flex justify-between items-center text-sm">
           <div className="flex flex-col text-left">
               <span className="text-slate-500 font-semibold mb-1">Your Balance</span>
               <span className="text-white flex items-center gap-1">
                   <Gem size={14} className="text-cyan-400" /> {userTokenBalance.toLocaleString()} VF
               </span>
           </div>
           <div className="w-px h-8 bg-slate-800 mx-4" />
           <div className="flex flex-col text-right">
               <span className="text-slate-500 font-semibold mb-1">Chapter Cost</span>
               <span className="text-amber-400 font-bold flex items-center justify-end gap-1">
                   <Gem size={14} /> {tokenCost} VF
               </span>
           </div>
        </div>

        <button
          onClick={handleUnlock}
          disabled={!canAfford || isUnlocking}
          className={`w-full py-3 px-6 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            canAfford 
             ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-[0_0_15px_rgba(245,158,11,0.3)]'
             : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {isUnlocking ? (
            <span className="animate-pulse">Authorizing...</span>
          ) : canAfford ? (
            <>
               <Unlock size={16} /> Unlock Chapter
            </>
          ) : (
            'Not enough VF Tokens'
          )}
        </button>

        {!canAfford && (
          <button className="mt-4 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors underline underline-offset-4">
            Get more VF Tokens
          </button>
        )}
      </div>
    </div>
  );
};
