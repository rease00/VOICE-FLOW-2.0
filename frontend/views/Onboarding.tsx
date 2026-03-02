
import React, { useState, useEffect } from 'react';
import { AppScreen } from '../types';
import { BrandLogo } from '../components/BrandLogo';

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
        
        <div className="mb-10 flex items-center justify-center">
          <BrandLogo size="hero" tone="light" showWordmark={false} />
        </div>

        <div className="text-center space-y-6 mb-12">
          <div className="flex justify-center">
            <BrandLogo size="lg" tone="light" />
          </div>
          
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
