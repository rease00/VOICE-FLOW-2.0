import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, RefreshCw, SkipBack, SkipForward } from 'lucide-react';
import { Visualizer } from './Visualizer';

interface AudioPlayerProps {
  audioUrl: string | null;
  backgroundMusicId?: string;
  initialSpeechVolume?: number;
  initialMusicVolume?: number;
  audioBuffer?: AudioBuffer | null;
  onReset: () => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ 
  audioUrl, 
  onReset 
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
        audioRef.current.pause();
    } else {
        audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if(!Number.isNaN(audioRef.current.duration)) {
          setDuration(audioRef.current.duration);
      }
    }
  };

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = parseFloat(e.target.value);
      if(audioRef.current) {
          audioRef.current.currentTime = time;
          setCurrentTime(time);
      }
  }

  if (!audioUrl) return null;

  return (
    <div className="w-full bg-white rounded-3xl p-6 shadow-xl border border-gray-100 animate-in">
      {/* Hidden Audio Element */}
      <audio 
        ref={audioRef} 
        src={audioUrl} 
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
        crossOrigin="anonymous"
      />

      {/* Visualizer Area */}
      <div className="h-32 bg-gray-50 rounded-2xl border border-gray-100 mb-6 flex items-center justify-center overflow-hidden relative">
         {!isPlaying && currentTime === 0 && (
             <div className="absolute text-gray-400 text-sm font-medium flex items-center gap-2 z-10">
                 Press Play to Listen
             </div>
         )}
         <Visualizer audioElement={audioRef.current} isPlaying={isPlaying} height={128} />
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4">
         {/* Progress Bar */}
         <div className="flex items-center gap-3 text-xs font-mono text-gray-500">
            <span>{formatTime(currentTime)}</span>
            <input 
                type="range" 
                min="0" 
                max={duration || 100} 
                value={currentTime} 
                onChange={handleSeek}
                className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-indigo-600"
            />
            <span>{formatTime(duration)}</span>
         </div>

         {/* Buttons */}
         <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <button 
                    onClick={() => { if(audioRef.current) audioRef.current.currentTime -= 5; }}
                    className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                >
                    <SkipBack size={20} />
                </button>

                <button 
                    onClick={togglePlay}
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all transform active:scale-95 ${isPlaying ? 'bg-white border-2 border-indigo-100 text-indigo-600' : 'bg-indigo-600 text-white hover:scale-105 hover:shadow-indigo-200'}`}
                >
                    {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                </button>

                <button 
                    onClick={() => { if(audioRef.current) audioRef.current.currentTime += 5; }}
                    className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                >
                    <SkipForward size={20} />
                </button>
            </div>

            <div className="flex items-center gap-2">
                <a 
                    href={audioUrl} 
                    download={`voiceflow_${Date.now()}.wav`} 
                    className="px-4 py-2 rounded-xl bg-gray-50 text-gray-700 font-bold text-xs hover:bg-gray-100 transition-colors flex items-center gap-2"
                >
                    <Download size={14} /> Save
                </a>
                <button 
                    onClick={onReset} 
                    className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Reset / New Generation"
                >
                    <RefreshCw size={18} />
                </button>
            </div>
         </div>
      </div>
    </div>
  );
};