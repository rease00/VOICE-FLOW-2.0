
import React, { useState, useEffect } from 'react';
import { AppScreen } from '../types';
import { Sparkles, Mic, Activity } from 'lucide-react';

interface OnboardingProps {
  setScreen: (screen: AppScreen) => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ setScreen }) => {
  const [activeSlide, setActiveSlide] = useState(0);

  // Auto slide
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlide(prev => (prev + 1) % 3);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto overflow-x-hidden bg-transparent px-4 py-6">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(65%_55%_at_12%_8%,rgba(99,102,241,0.28),transparent_62%),radial-gradient(55%_48%_at_88%_14%,rgba(14,165,233,0.22),transparent_64%),linear-gradient(160deg,#0d0e15_0%,#141726_52%,#161a28_100%)]" />

      {/* Grid Overlay */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:46px_46px]" />

      <div className="vf-glass-panel z-10 flex w-full max-w-md flex-col items-center rounded-[2rem] border border-white/20 bg-white/5 p-6 shadow-[0_28px_65px_rgba(3,5,12,0.48)]">
        
        {/* 3D Floating Icon Container */}
        <div className="relative w-72 h-72 flex items-center justify-center mb-12">
           <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full opacity-20 animate-pulse"></div>
           <div className="relative z-10 rounded-[3rem] border border-white/25 bg-white/10 p-8 shadow-2xl backdrop-blur-md transform transition-transform duration-500 hover:scale-105">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-2xl shadow-lg">
                 <Mic size={64} className="text-white drop-shadow-md" />
              </div>
              {/* Floating Elements */}
              <div className="absolute -top-6 -right-4 bg-amber-400 p-3 rounded-2xl shadow-lg animate-bounce delay-100">
                <Sparkles size={24} className="text-white" />
              </div>
              <div className="absolute -bottom-4 -left-4 bg-pink-500 p-3 rounded-2xl shadow-lg animate-bounce delay-700">
                <Activity size={24} className="text-white" />
              </div>
           </div>
        </div>

        <div className="text-center space-y-6 mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight tracking-tight drop-shadow-lg">
            Voice<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-purple-300">Flow</span>
            <br/><span className="text-2xl md:text-3xl font-medium opacity-90">AI Studio</span>
          </h1>
          
          <div className="h-20 relative overflow-hidden">
             {/* Animated Text Slider */}
             <div className="transition-transform duration-500 ease-in-out" style={{ transform: `translateY(-${activeSlide * 100}%)` }}>
                <div className="h-20 flex items-center justify-center">
                   <p className="text-indigo-100 px-8 text-lg leading-relaxed font-light text-center">
                     Instantly convert any text into lifelike, natural speech.
                   </p>
                </div>
                <div className="h-20 flex items-center justify-center">
                   <p className="text-purple-100 px-8 text-lg leading-relaxed font-light text-center">
                     Auto-detect multiple speakers and assign unique voices.
                   </p>
                </div>
                <div className="h-20 flex items-center justify-center">
                   <p className="text-pink-100 px-8 text-lg leading-relaxed font-light text-center">
                     Support for multiple languages & custom backend models.
                   </p>
                </div>
             </div>
          </div>
        </div>

        <div className="w-full flex flex-col items-center gap-8">
          {/* Pagination Dots */}
          <div className="flex space-x-3">
            {[0, 1, 2].map(i => (
              <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${activeSlide === i ? 'w-8 bg-white' : 'w-2 bg-white/30'}`}></div>
            ))}
          </div>

          <button 
            onClick={() => setScreen(AppScreen.LOGIN)}
            className="w-full py-4 rounded-2xl bg-white text-indigo-900 font-bold text-lg shadow-xl shadow-indigo-900/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
};
