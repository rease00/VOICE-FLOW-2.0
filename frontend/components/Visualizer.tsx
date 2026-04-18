import React, { useEffect, useRef, useState } from 'react';
import { getAudioContext } from '../services/geminiService';

interface VisualizerProps {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
  height?: number;
}

interface VisualizerPalette {
  primary: string;
  secondary: string;
  tertiary: string;
}

const sourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
const DEFAULT_PALETTE: VisualizerPalette = {
  primary: '#22d3ee',
  secondary: '#818cf8',
  tertiary: '#f472b6',
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void => {
  const r = clampNumber(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

export const Visualizer: React.FC<VisualizerProps> = ({ audioElement, isPlaying, height = 128 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const frequencyDataRef = useRef<Uint8Array | null>(null);
  const timeDataRef = useRef<Uint8Array | null>(null);
  const smoothedPeaksRef = useRef<Float32Array | null>(null);
  const gradientRef = useRef<CanvasGradient | null>(null);
  const gradientKeyRef = useRef<string>('');
  const graphConnectedRef = useRef(false);
  const connectedElementRef = useRef<HTMLAudioElement | null>(null);
  const connectedSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const paletteRef = useRef<VisualizerPalette>(DEFAULT_PALETTE);
  const dprRef = useRef<number>(1);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const readPalette = () => {
      const body = document.body;
      if (!body) return;
      const computed = getComputedStyle(body);
      const primary = computed.getPropertyValue('--vf-accent-primary').trim();
      const secondary = computed.getPropertyValue('--vf-accent-secondary').trim();
      const tertiary = computed.getPropertyValue('--vf-accent-tertiary').trim();
      paletteRef.current = {
        primary: primary || DEFAULT_PALETTE.primary,
        secondary: secondary || DEFAULT_PALETTE.secondary,
        tertiary: tertiary || DEFAULT_PALETTE.tertiary,
      };
    };
    readPalette();
    const observer = new MutationObserver(readPalette);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-vf-brand-theme', 'data-vf-theme-mode', 'data-vf-resolved-theme'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.('change', update);
    return () => mediaQuery.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioElement) return;

    const audioCtx = getAudioContext();
    if (!analyserRef.current) {
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.84;
      analyser.minDecibels = -88;
      analyser.maxDecibels = -12;
      analyserRef.current = analyser;
    }
    const analyser = analyserRef.current;

    if (connectedElementRef.current !== audioElement) {
      if (connectedSourceRef.current) {
        try {
          connectedSourceRef.current.disconnect();
        } catch {
          // Ignore disconnect failures while swapping sources.
        }
        connectedSourceRef.current = null;
      }
      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect();
        } catch {
          // Ignore disconnect failures while swapping sources.
        }
      }
      connectedElementRef.current = audioElement;
      graphConnectedRef.current = false;
    }

    if (!graphConnectedRef.current) {
      try {
        let source = sourceCache.get(audioElement);
        if (!source) {
          source = audioCtx.createMediaElementSource(audioElement);
          sourceCache.set(audioElement, source);
        }
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        connectedSourceRef.current = source;
        graphConnectedRef.current = true;
      } catch (error) {
        // The graph may already be connected, which is safe to ignore.
        console.warn('Visualizer connection warning:', error);
      }
    }

    if (isPlaying && audioCtx.state === 'suspended') {
      void audioCtx.resume().catch((error) => {
        console.error('Audio resume failed', error);
      });
    }

    const render = () => {
      const nextCanvas = canvasRef.current;
      const nextAnalyser = analyserRef.current;
      if (!nextCanvas || !nextAnalyser) return;

      const context2d = nextCanvas.getContext('2d');
      if (!context2d) return;

      const width = nextCanvas.width;
      const visualHeight = nextCanvas.height;
      if (width <= 0 || visualHeight <= 0) return;

      const dpr = dprRef.current || 1;
      const logicalWidth = width / dpr;
      const logicalHeight = visualHeight / dpr;
      context2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (!frequencyDataRef.current || frequencyDataRef.current.length !== nextAnalyser.frequencyBinCount) {
        frequencyDataRef.current = new Uint8Array(nextAnalyser.frequencyBinCount);
      }
      if (!timeDataRef.current || timeDataRef.current.length !== nextAnalyser.fftSize) {
        timeDataRef.current = new Uint8Array(nextAnalyser.fftSize);
      }
      const frequencyData = frequencyDataRef.current;
      const timeData = timeDataRef.current;
      nextAnalyser.getByteFrequencyData(frequencyData);
      nextAnalyser.getByteTimeDomainData(timeData);

      let rmsAccumulator = 0;
      for (let index = 0; index < timeData.length; index += 1) {
        const centered = ((timeData[index] ?? 128) - 128) / 128;
        rmsAccumulator += centered * centered;
      }
      const rms = Math.sqrt(rmsAccumulator / timeData.length);

      const barCount = clampNumber(Math.floor(logicalWidth / 11), 28, 96);
      if (!smoothedPeaksRef.current || smoothedPeaksRef.current.length !== barCount) {
        smoothedPeaksRef.current = new Float32Array(barCount);
      }
      const smoothedPeaks = smoothedPeaksRef.current;
      const binStep = frequencyData.length / barCount;
      const gap = 2;
      const barWidth = (logicalWidth - (barCount - 1) * gap) / barCount;
      const centerY = logicalHeight / 2;
      const minBarHeight = Math.max(4, logicalHeight * 0.08);
      const maxBarHeight = logicalHeight * 0.9;
      const energyFloor = clampNumber(rms * 2.2, 0.06, 0.32);

      for (let index = 0; index < barCount; index += 1) {
        const start = Math.floor(index * binStep);
        const end = Math.max(start + 1, Math.floor((index + 1) * binStep));
        let sum = 0;
        for (let cursor = start; cursor < end; cursor += 1) {
          sum += frequencyData[cursor] || 0;
        }
        const average = sum / (end - start);
        const normalized = average / 255;
        const shaped = Math.pow(normalized, 1.35);
        const lowBandBoost = 1 + (1 - index / barCount) * 0.28;
        const target = clampNumber(Math.max(shaped * lowBandBoost, energyFloor * 0.6), 0.03, 1);
        const previous = smoothedPeaks[index] || 0;
        const attack = 0.38;
        const release = 0.14;
        smoothedPeaks[index] = target > previous
          ? previous + (target - previous) * attack
          : previous - (previous - target) * release;
      }

      const palette = paletteRef.current;
      const gradientKey = `${logicalWidth}:${logicalHeight}:${palette.primary}:${palette.secondary}:${palette.tertiary}`;
      if (!gradientRef.current || gradientKeyRef.current !== gradientKey) {
        const gradient = context2d.createLinearGradient(0, logicalHeight, logicalWidth, 0);
        gradient.addColorStop(0, palette.primary);
        gradient.addColorStop(0.55, palette.secondary);
        gradient.addColorStop(1, palette.tertiary);
        gradientRef.current = gradient;
        gradientKeyRef.current = gradientKey;
      }

      context2d.clearRect(0, 0, logicalWidth, logicalHeight);

      context2d.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      context2d.lineWidth = 1;
      context2d.beginPath();
      context2d.moveTo(0, centerY + 0.5);
      context2d.lineTo(logicalWidth, centerY + 0.5);
      context2d.stroke();

      const pointCount = clampNumber(Math.floor(logicalWidth / 6), 48, 180);
      const sampleStep = (timeData.length - 1) / Math.max(1, pointCount - 1);
      const amplitude = clampNumber(logicalHeight * (0.14 + rms * 0.52), logicalHeight * 0.1, logicalHeight * 0.34);
      context2d.beginPath();
      let previousX = 0;
      let previousY = centerY;
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const sampleIndex = Math.min(timeData.length - 1, Math.floor(pointIndex * sampleStep));
        const normalized = ((timeData[sampleIndex] ?? 128) - 128) / 128;
        const x = (pointIndex / Math.max(1, pointCount - 1)) * logicalWidth;
        const y = centerY + normalized * amplitude;
        if (pointIndex === 0) {
          context2d.moveTo(x, y);
        } else {
          const controlX = (previousX + x) / 2;
          const controlY = (previousY + y) / 2;
          context2d.quadraticCurveTo(previousX, previousY, controlX, controlY);
        }
        previousX = x;
        previousY = y;
      }
      context2d.lineTo(previousX, previousY);
      context2d.globalAlpha = 0.22;
      context2d.strokeStyle = palette.secondary;
      context2d.lineWidth = 7;
      context2d.stroke();
      context2d.globalAlpha = 0.88;
      context2d.strokeStyle = palette.primary;
      context2d.lineWidth = 2.2;
      context2d.stroke();
      context2d.globalAlpha = 1;

      context2d.fillStyle = gradientRef.current;
      context2d.shadowColor = palette.secondary;
      context2d.shadowBlur = isPlaying ? 12 : 6;

      for (let index = 0; index < barCount; index += 1) {
        const level = smoothedPeaks[index] || 0;
        const barHeight = clampNumber(level * maxBarHeight, minBarHeight, maxBarHeight);
        const x = index * (barWidth + gap);
        const y = centerY - barHeight / 2;
        drawRoundedRect(context2d, x, y, Math.max(1, barWidth), barHeight, Math.max(1, barWidth / 2));
        context2d.fill();
      }

      context2d.shadowBlur = 0;

      if (isPlaying && !prefersReducedMotion) {
        animationFrameRef.current = requestAnimationFrame(render);
      }
    };

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (isPlaying || audioElement.currentTime > 0) {
      render();
    } else {
      const context2d = canvas.getContext('2d');
      if (context2d) {
        context2d.setTransform(1, 0, 0, 1, 0, 0);
        context2d.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (connectedElementRef.current === audioElement) {
        if (connectedSourceRef.current) {
          try {
            connectedSourceRef.current.disconnect();
          } catch {
            // Ignore disconnect failures on unmount.
          }
          connectedSourceRef.current = null;
        }
        if (analyserRef.current) {
          try {
            analyserRef.current.disconnect();
          } catch {
            // Ignore disconnect failures on unmount.
          }
        }
        graphConnectedRef.current = false;
        connectedElementRef.current = null;
      }
    };
  }, [audioElement, isPlaying, prefersReducedMotion]);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      const parent = canvas?.parentElement;
      if (!canvas || !parent) return;

      const targetWidth = Math.max(1, Math.floor(parent.clientWidth));
      const targetHeight = Math.max(1, Math.floor(height));
      const dpr = clampNumber(window.devicePixelRatio || 1, 1, 2);
      dprRef.current = dpr;
      const renderWidth = Math.max(1, Math.floor(targetWidth * dpr));
      const renderHeight = Math.max(1, Math.floor(targetHeight * dpr));

      if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
      }
      if (canvas.style.width !== `${targetWidth}px`) {
        canvas.style.width = `${targetWidth}px`;
      }
      if (canvas.style.height !== `${targetHeight}px`) {
        canvas.style.height = `${targetHeight}px`;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [height]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className="vf-live-player__viz-canvas w-full rounded-xl"
      style={{ height: `${height}px` }}
      aria-hidden="true"
      role="presentation"
      tabIndex={-1}
      data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
    />
  );
};
