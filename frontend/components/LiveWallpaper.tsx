import React, { useEffect, useRef } from 'react';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
};

export type LiveWallpaperMode = 'quality' | 'balanced' | 'saver';

interface LiveWallpaperProps {
  mode: LiveWallpaperMode;
  active?: boolean;
}

const MODE_CONFIG: Record<
  LiveWallpaperMode,
  {
    fps: number;
    maxDpr: number;
    minParticles: number;
    maxParticles: number;
    particleAreaFactor: number;
    allowBlend: boolean;
    dynamicGradients: boolean;
    animateParticles: boolean;
  }
> = {
  quality: {
    fps: 24,
    maxDpr: 1.5,
    minParticles: 14,
    maxParticles: 52,
    particleAreaFactor: 52000,
    allowBlend: true,
    dynamicGradients: true,
    animateParticles: true,
  },
  balanced: {
    fps: 12,
    maxDpr: 1.0,
    minParticles: 8,
    maxParticles: 24,
    particleAreaFactor: 90000,
    allowBlend: false,
    dynamicGradients: false,
    animateParticles: true,
  },
  saver: {
    fps: 0,
    maxDpr: 1.0,
    minParticles: 0,
    maxParticles: 0,
    particleAreaFactor: 999999999,
    allowBlend: false,
    dynamicGradients: false,
    animateParticles: false,
  },
};

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, value))
);

const createParticle = (width: number, height: number): Particle => ({
  x: Math.random() * Math.max(1, width),
  y: Math.random() * Math.max(1, height),
  vx: (Math.random() - 0.5) * 0.9,
  vy: (Math.random() - 0.5) * 0.9,
  radius: 0.8 + Math.random() * 2.3,
  alpha: 0.14 + Math.random() * 0.3,
});

export const LiveWallpaper: React.FC<LiveWallpaperProps> = ({ mode, active = true }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let lastFrameMs = 0;
    let rafId: number | null = null;
    let running = false;
    const particles: Particle[] = [];
    const config = MODE_CONFIG[mode];
    const frameIntervalMs = config.fps > 0 ? (1000 / config.fps) : Number.POSITIVE_INFINITY;

    const isDarkTheme = () => document.body.classList.contains('theme-dark');
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    let cachedTheme: 'light' | 'dark' | '' = '';
    let cachedWidth = -1;
    let cachedHeight = -1;
    let cachedBaseGradient: CanvasGradient | null = null;
    let cachedAuroraA: CanvasGradient | null = null;
    let cachedAuroraB: CanvasGradient | null = null;

    const syncParticleCount = () => {
      const targetCount = clamp(
        Math.round((width * height) / config.particleAreaFactor),
        config.minParticles,
        config.maxParticles
      );
      while (particles.length < targetCount) {
        particles.push(createParticle(width, height));
      }
      if (particles.length > targetCount) {
        particles.length = targetCount;
      }
    };

    const syncCanvasSize = () => {
      dpr = Math.min(config.maxDpr, Math.max(1, window.devicePixelRatio || 1));
      width = Math.max(1, Math.floor(window.innerWidth));
      height = Math.max(1, Math.floor(window.innerHeight));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      syncParticleCount();
      cachedWidth = -1;
      cachedHeight = -1;
    };

    const getStaticGradients = (dark: boolean) => {
      const themeKey = dark ? 'dark' : 'light';
      if (
        cachedBaseGradient &&
        cachedAuroraA &&
        cachedAuroraB &&
        cachedTheme === themeKey &&
        cachedWidth === width &&
        cachedHeight === height
      ) {
        return {
          baseGradient: cachedBaseGradient,
          auroraA: cachedAuroraA,
          auroraB: cachedAuroraB,
        };
      }

      cachedTheme = themeKey;
      cachedWidth = width;
      cachedHeight = height;

      const baseGradient = ctx.createLinearGradient(0, 0, width, height);
      if (dark) {
        baseGradient.addColorStop(0, '#031228');
        baseGradient.addColorStop(0.5, '#072036');
        baseGradient.addColorStop(1, '#0a2a3b');
      } else {
        baseGradient.addColorStop(0, '#e8f7fb');
        baseGradient.addColorStop(0.48, '#dbf3ff');
        baseGradient.addColorStop(1, '#d9ecff');
      }

      const auroraA = ctx.createRadialGradient(
        width * 0.2,
        height * 0.15,
        0,
        width * 0.3,
        height * 0.25,
        Math.max(width, height) * 0.9
      );
      if (dark) {
        auroraA.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
        auroraA.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
      } else {
        auroraA.addColorStop(0, 'rgba(20, 184, 166, 0.16)');
        auroraA.addColorStop(1, 'rgba(20, 184, 166, 0.0)');
      }

      const auroraB = ctx.createRadialGradient(
        width * 0.82,
        height * 0.78,
        0,
        width * 0.8,
        height * 0.7,
        Math.max(width, height) * 0.85
      );
      if (dark) {
        auroraB.addColorStop(0, 'rgba(45, 212, 191, 0.14)');
        auroraB.addColorStop(1, 'rgba(45, 212, 191, 0.0)');
      } else {
        auroraB.addColorStop(0, 'rgba(14, 165, 233, 0.13)');
        auroraB.addColorStop(1, 'rgba(14, 165, 233, 0.0)');
      }

      cachedBaseGradient = baseGradient;
      cachedAuroraA = auroraA;
      cachedAuroraB = auroraB;

      return { baseGradient, auroraA, auroraB };
    };

    const drawFrame = (timestampMs: number, animate: boolean, dtSeconds: number = 0) => {
      const phase = timestampMs * 0.0002;
      const dark = isDarkTheme();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      let baseGradient: CanvasGradient;
      let auroraA: CanvasGradient;
      let auroraB: CanvasGradient;

      if (config.dynamicGradients) {
        baseGradient = ctx.createLinearGradient(0, 0, width, height);
        if (dark) {
          baseGradient.addColorStop(0, '#031228');
          baseGradient.addColorStop(0.5, '#072036');
          baseGradient.addColorStop(1, '#0a2a3b');
        } else {
          baseGradient.addColorStop(0, '#e8f7fb');
          baseGradient.addColorStop(0.48, '#dbf3ff');
          baseGradient.addColorStop(1, '#d9ecff');
        }

        auroraA = ctx.createRadialGradient(
          width * (0.2 + Math.sin(phase * 1.2) * 0.08),
          height * (0.15 + Math.cos(phase * 1.1) * 0.06),
          0,
          width * 0.3,
          height * 0.25,
          Math.max(width, height) * 0.9
        );
        auroraB = ctx.createRadialGradient(
          width * (0.82 + Math.cos(phase * 0.9) * 0.07),
          height * (0.78 + Math.sin(phase * 1.05) * 0.08),
          0,
          width * 0.8,
          height * 0.7,
          Math.max(width, height) * 0.85
        );

        if (dark) {
          auroraA.addColorStop(0, 'rgba(56, 189, 248, 0.20)');
          auroraA.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
          auroraB.addColorStop(0, 'rgba(45, 212, 191, 0.16)');
          auroraB.addColorStop(1, 'rgba(45, 212, 191, 0.0)');
        } else {
          auroraA.addColorStop(0, 'rgba(20, 184, 166, 0.18)');
          auroraA.addColorStop(1, 'rgba(20, 184, 166, 0.0)');
          auroraB.addColorStop(0, 'rgba(14, 165, 233, 0.15)');
          auroraB.addColorStop(1, 'rgba(14, 165, 233, 0.0)');
        }
      } else {
        const gradients = getStaticGradients(dark);
        baseGradient = gradients.baseGradient;
        auroraA = gradients.auroraA;
        auroraB = gradients.auroraB;
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = baseGradient;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = config.allowBlend ? 'lighter' : 'source-over';
      ctx.fillStyle = auroraA;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = auroraB;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'source-over';
      for (const particle of particles) {
        if (animate && config.animateParticles) {
          particle.x += particle.vx * dtSeconds * 26;
          particle.y += particle.vy * dtSeconds * 26;
          if (particle.x < -6) particle.x = width + 6;
          if (particle.x > width + 6) particle.x = -6;
          if (particle.y < -6) particle.y = height + 6;
          if (particle.y > height + 6) particle.y = -6;
        }
        const opacity = dark ? particle.alpha * 0.85 : particle.alpha;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fillStyle = dark
          ? `rgba(148, 226, 255, ${opacity.toFixed(3)})`
          : `rgba(15, 118, 110, ${opacity.toFixed(3)})`;
        ctx.fill();
      }
    };

    const stopLoop = () => {
      running = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const frameLoop = (timestampMs: number) => {
      if (!running) return;
      if (mode === 'saver' || reducedMotionQuery.matches || document.hidden || !active) {
        stopLoop();
        drawFrame(timestampMs, false);
        return;
      }
      const elapsed = timestampMs - lastFrameMs;
      if (elapsed >= frameIntervalMs) {
        const dt = Math.min(0.06, Math.max(0.001, elapsed / 1000));
        lastFrameMs = timestampMs;
        drawFrame(timestampMs, true, dt);
      }
      rafId = requestAnimationFrame(frameLoop);
    };

    const startLoop = () => {
      if (
        running ||
        mode === 'saver' ||
        reducedMotionQuery.matches ||
        document.hidden ||
        !active ||
        config.fps <= 0
      ) {
        return;
      }
      running = true;
      lastFrameMs = performance.now();
      rafId = requestAnimationFrame(frameLoop);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
        return;
      }
      drawFrame(performance.now(), false);
      startLoop();
    };

    const onResize = () => {
      syncCanvasSize();
      drawFrame(performance.now(), false);
      startLoop();
    };

    const onReducedMotionChange = () => {
      if (reducedMotionQuery.matches || mode === 'saver' || !active) {
        stopLoop();
        drawFrame(performance.now(), false);
      } else {
        drawFrame(performance.now(), false);
        startLoop();
      }
    };

    const bodyClassObserver = new MutationObserver(() => {
      drawFrame(performance.now(), false);
    });

    syncCanvasSize();
    drawFrame(performance.now(), false);
    startLoop();

    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', onReducedMotionChange);
    } else {
      reducedMotionQuery.addListener(onReducedMotionChange);
    }

    return () => {
      stopLoop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      bodyClassObserver.disconnect();
      if (typeof reducedMotionQuery.removeEventListener === 'function') {
        reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
      } else {
        reducedMotionQuery.removeListener(onReducedMotionChange);
      }
    };
  }, [mode, active]);

  return (
    <div className="vf-live-canvas-wallpaper" aria-hidden="true">
      <canvas ref={canvasRef} className="vf-live-canvas-wallpaper__canvas" />
      <div className="vf-live-canvas-wallpaper__veil" />
    </div>
  );
};
