import React, { useRef, useEffect } from 'react';
import { getAudioContext } from '../services/geminiService';

interface VisualizerProps {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
  height?: number;
}

// Global WeakMap to store AudioSourceNodes associated with Audio Elements
// This prevents "MediaElementAudioSourceNode has already been created" errors
const sourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

export const Visualizer: React.FC<VisualizerProps> = ({ audioElement, isPlaying, height = 128 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioElement || !canvasRef.current) return;

    const initAudio = () => {
      // Use Shared Singleton AudioContext from service
      const ctx = getAudioContext();
      
      // Init Analyser if needed
      if (!analyserRef.current) {
         analyserRef.current = ctx.createAnalyser();
         analyserRef.current.fftSize = 256;
      }
      const analyser = analyserRef.current;

      try {
        // Reuse existing source or create new one safely
        // Since we now use a singleton AudioContext, the source cache should stay valid for the lifetime of the element+context
        let source = sourceCache.get(audioElement);
        if (!source) {
            source = ctx.createMediaElementSource(audioElement);
            sourceCache.set(audioElement, source);
        }
        
        // Connect source to analyser
        // Note: Disconnecting first is good practice if component remounts frequently
        try { source.disconnect(); } catch(e) {} 
        
        source.connect(analyser);
        analyser.connect(ctx.destination);
      } catch (e) {
        console.warn("Visualizer connection warning:", e);
      }
    };

    if (isPlaying) {
      initAudio();
      // Resume if needed
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(e => console.error("Audio resume failed", e));
      }
    }

    const render = () => {
      if (!canvasRef.current || !analyserRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);

      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      const barWidth = (w / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // Gradient for bars
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, 'rgba(99, 102, 241, 0.8)'); // Indigo-500
      gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.8)'); // Purple-500
      gradient.addColorStop(1, 'rgba(236, 72, 153, 0.8)'); // Pink-500

      for (let i = 0; i < bufferLength; i++) {
        // Smooth out bar height
        barHeight = dataArray[i] / 2; // Scale down slightly
        
        // Draw rounded bar
        ctx.fillStyle = gradient;
        
        // Rounded top
        if (barHeight > 0) {
            ctx.beginPath();
            // x, y, width, height, radius
            const radius = barWidth / 2;
            const y = h - barHeight;
            
            ctx.moveTo(x, y + radius);
            ctx.lineTo(x, h);
            ctx.lineTo(x + barWidth, h);
            ctx.lineTo(x + barWidth, y + radius);
            ctx.arc(x + radius, y + radius, radius, Math.PI * 2, Math.PI, true);
            ctx.fill();
        }

        x += barWidth + 2; // Spacing
      }

      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(render);
      }
    };

    if (isPlaying) {
      render();
    } else {
       // Clear canvas when stopped
       const canvas = canvasRef.current;
       const ctx = canvas.getContext('2d');
       if(ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
       if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [audioElement, isPlaying]);

  // Responsive canvas sizing
  useEffect(() => {
      const resize = () => {
          if(canvasRef.current && canvasRef.current.parentElement) {
              canvasRef.current.width = canvasRef.current.parentElement.clientWidth;
              canvasRef.current.height = height;
          }
      }
      resize();
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
  }, [height]);

  return (
    <canvas 
        ref={canvasRef} 
        height={height} 
        className="w-full rounded-xl" 
        style={{ height: `${height}px` }} 
    />
  );
};