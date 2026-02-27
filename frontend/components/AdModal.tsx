
import React, { useState, useEffect } from 'react';
import { X, Play, Loader2 } from 'lucide-react';
import { Button } from './Button';

interface AdModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReward: () => void;
}

export const AdModal: React.FC<AdModalProps> = ({ isOpen, onClose, onReward }) => {
  const [timeLeft, setTimeLeft] = useState(5);
  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsAdPlaying(true);
      setTimeLeft(5);
      setIsCompleted(false);
    }
  }, [isOpen]);

  useEffect(() => {
    let timer: any; // Using 'any' to handle both NodeJS.Timeout and number (browser) types safely
    if (isAdPlaying && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isAdPlaying) {
      setIsAdPlaying(false);
      setIsCompleted(true);
      onReward();
    }
    return () => clearInterval(timer);
  }, [isAdPlaying, timeLeft, onReward]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl relative">
        
        {/* Header */}
        <div className="bg-gray-100 p-3 flex justify-between items-center border-b border-gray-200">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
             Sponsored Message
          </span>
          {isCompleted && (
             <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
               <X size={20} />
             </button>
          )}
        </div>

        {/* Content */}
        <div className="aspect-video bg-black relative flex items-center justify-center">
            {!isCompleted ? (
                <>
                  <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-md font-mono">
                    {timeLeft}s
                  </div>
                  <div className="text-center">
                    <Loader2 size={40} className="text-white animate-spin mx-auto mb-2" />
                    <p className="text-white text-sm font-medium">Playing Advertisement...</p>
                  </div>
                </>
            ) : (
                <div className="flex flex-col items-center justify-center text-green-400">
                   <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-2">
                      <Play size={32} fill="currentColor" />
                   </div>
                   <p className="text-white font-bold">Reward Earned!</p>
                </div>
            )}
        </div>

        <div className="p-6 text-center space-y-4">
           <h3 className="font-bold text-lg text-gray-900">
             {isCompleted ? "Thanks for watching!" : "Watch to claim VFF"}
           </h3>
          <p className="text-gray-500 text-sm">
             Support us by watching a short video to get +1000 VFF for any engine. Daily max: 3 claims.
           </p>

           {isCompleted && (
             <Button fullWidth onClick={onClose} className="bg-green-600 hover:bg-green-700">
               Continue to App
             </Button>
           )}
        </div>
      </div>
    </div>
  );
};
