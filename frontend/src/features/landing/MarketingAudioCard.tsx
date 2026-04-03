'use client';

import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export interface MarketingAudioCardBadge {
  label: string;
  tone?: 'neutral' | 'accent' | 'warm';
}

export interface MarketingAudioCardProps {
  eyebrow: string;
  title: string;
  summary: string;
  audioSrc: string;
  ariaLabel: string;
  preload?: 'none' | 'metadata';
  note?: string;
  badges?: readonly MarketingAudioCardBadge[];
  cast?: readonly string[];
  fallback?: string;
  variant?: 'hero' | 'list' | 'scene';
}

const DEFAULT_FALLBACK = 'Audio preview is not available right now.';

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const WAVE_BARS = [0.44, 0.82, 0.58, 0.92, 0.66, 0.76, 0.52, 0.88, 0.48, 0.72] as const;

export function MarketingAudioCard({
  eyebrow,
  title,
  summary,
  audioSrc,
  ariaLabel,
  preload = 'none',
  note,
  badges = [],
  cast = [],
  fallback = DEFAULT_FALLBACK,
  variant = 'list',
}: MarketingAudioCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressId = useId();
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const syncState = () => {
      setCurrentTime(audio.currentTime || 0);
      setDuration(audio.duration || 0);
      setIsPlaying(!audio.paused && !audio.ended);
      setIsReady(Number.isFinite(audio.duration) && audio.duration > 0);
    };

    const handleLoaded = () => {
      setHasError(false);
      syncState();
    };

    const handleError = () => {
      setHasError(true);
      setIsPlaying(false);
      setIsReady(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || audio.currentTime || 0);
    };

    syncState();
    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('durationchange', handleLoaded);
    audio.addEventListener('timeupdate', syncState);
    audio.addEventListener('play', syncState);
    audio.addEventListener('pause', syncState);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('durationchange', handleLoaded);
      audio.removeEventListener('timeupdate', syncState);
      audio.removeEventListener('play', syncState);
      audio.removeEventListener('pause', syncState);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  const progressMax = duration > 0 ? duration : 1;
  const progressValue = Math.min(currentTime, progressMax);
  const progressPercent = progressMax > 0 ? Math.min((progressValue / progressMax) * 100, 100) : 0;
  const waveState = isPlaying && isReady && !hasError ? 'active' : 'idle';

  const waveformStyle = {
    '--vf-audio-progress': `${progressPercent}%`,
  } as CSSProperties;

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || hasError) return;

    if (audio.paused || audio.ended) {
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
      }
      return;
    }

    audio.pause();
  };

  const handleSeek = (nextValue: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) return;
    audio.currentTime = parsed;
    setCurrentTime(parsed);
  };

  const showTransport = !hasError;

  return (
    <article
      className={`vf-marketing-audio-card vf-marketing-audio-card--${variant}`}
      data-audio-player="vf-marketing"
      data-audio-state={hasError ? 'error' : isPlaying ? 'playing' : isReady ? 'ready' : 'idle'}
    >
      <audio ref={audioRef} preload={preload} src={audioSrc} aria-label={ariaLabel} />

      <div className="vf-marketing-audio-card__head">
        <div>
          <p className="vf-marketing-audio-card__eyebrow">{eyebrow}</p>
          <h3 className="vf-marketing-audio-card__title">{title}</h3>
        </div>
        {badges.length > 0 ? (
          <div className="vf-marketing-audio-card__badges" aria-label={`${title} highlights`}>
            {badges.map((badge) => (
              <span
                key={`${title}-${badge.label}`}
                className={`vf-marketing-audio-card__badge vf-marketing-audio-card__badge--${badge.tone || 'neutral'}`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="vf-marketing-audio-card__summary">{summary}</p>

      {cast.length > 0 ? (
        <div className="vf-marketing-audio-card__cast" aria-label={`${title} cast`}>
          {cast.map((member) => (
            <span key={`${title}-${member}`} className="vf-marketing-audio-card__cast-chip">
              {member}
            </span>
          ))}
        </div>
      ) : null}

      {showTransport ? (
        <>
          <div
            className="vf-marketing-audio-card__wave"
            aria-hidden="true"
            data-wave-state={waveState}
            style={waveformStyle}
          >
            {WAVE_BARS.map((height, index) => (
              <span
                key={`${title}-wave-${index}`}
                className="vf-marketing-audio-card__wave-bar"
                style={{ '--vf-wave-scale': height, animationDelay: `${index * 120}ms` } as CSSProperties}
              />
            ))}
          </div>

          <div className="vf-marketing-audio-card__transport">
            <button
              type="button"
              className="vf-marketing-audio-card__play"
              onClick={togglePlayback}
              aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>

            <div className="vf-marketing-audio-card__timeline">
              <label className="sr-only" htmlFor={progressId}>
                Seek {title}
              </label>
              <input
                id={progressId}
                className="vf-marketing-audio-card__progress"
                type="range"
                min={0}
                max={progressMax}
                step={0.1}
                value={progressValue}
                onChange={(event) => handleSeek(event.target.value)}
                aria-valuemin={0}
                aria-valuemax={Math.round(progressMax)}
                aria-valuenow={Math.round(progressValue)}
                aria-valuetext={`${formatTime(progressValue)} of ${formatTime(duration)}`}
              />
              <div className="vf-marketing-audio-card__times" aria-live="off">
                <span>{formatTime(progressValue)}</span>
                <span>{isReady ? formatTime(duration) : 'Loading'}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="vf-marketing-audio-card__fallback">{fallback}</div>
      )}

      {note ? <p className="vf-marketing-audio-card__note">{note}</p> : null}
    </article>
  );
}
