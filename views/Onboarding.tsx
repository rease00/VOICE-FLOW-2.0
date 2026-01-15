
import React, { useState, useEffect } from 'react';
import { Button } from '../components/Button';
import { AppScreen } from '../types';
import { Sparkles, Mic, Radio, Activity } from 'lucide-react';

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
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden w-full">
      
      {/* Live Animated Background */}
      <div className="absolute inset-0 z-0 opacity-70 pointer-events-none">
         <div className="absolute top-[-20%] left-[-20%] w-[60vw] h-[60vw] bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
         <div className="absolute top-[10%] right-[-20%] w-[60vw] h-[60vw] bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
         <div className="absolute bottom-[-20%] left-[20%] w-[60vw] h-[60vw] bg-pink-600 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
      </div>

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 z-0 pointer-events-none"></div>

      <div className="z-10 w-full max-w-md p-6 flex flex-col items-center">
        
        {/* 3D Floating Icon Container */}
        <div className="relative w-72 h-72 flex items-center justify-center mb-12">
           <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full opacity-20 animate-pulse"></div>
           <div className="relative z-10 bg-white/10 backdrop-blur-md border border-white/20 p-8 rounded-[3rem] shadow-2xl transform transition-transform hover:scale-105 duration-500">
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
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}} />
    </div>
  );
};