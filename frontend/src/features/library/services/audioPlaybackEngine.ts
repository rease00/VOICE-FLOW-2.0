/**
 * Audio Playback Engine
 * Manages dual-channel audio playback: SFX channel and BGM channel.
 * Supports ducking (lower BGM volume during TTS), crossfade, and scheduling.
 */

import type { PlaybackScheduleItem } from './audioTagParser';

export interface EngineConfig {
  sfxVolume: number; // 0-1
  bgmVolume: number; // 0-1
  duckingLevel: number; // 0-1, how much to lower BGM during TTS
  crossfadeDuration: number; // seconds
  enabled: boolean;
}

const DEFAULT_CONFIG: EngineConfig = {
  sfxVolume: 0.6,
  bgmVolume: 0.3,
  duckingLevel: 0.4,
  crossfadeDuration: 2,
  enabled: false,
};

export class AudioPlaybackEngine {
  private config: EngineConfig;
  private sfxAudio: HTMLAudioElement | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmFadeAudio: HTMLAudioElement | null = null;
  private schedule: PlaybackScheduleItem[] = [];
  private scheduledTimeouts: ReturnType<typeof setTimeout>[] = [];
  private assetResolver: ((id: string, type: 'sfx' | 'bgm') => string | null) | null = null;

  constructor(config?: Partial<EngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setAssetResolver(resolver: (id: string, type: 'sfx' | 'bgm') => string | null) {
    this.assetResolver = resolver;
  }

  updateConfig(updates: Partial<EngineConfig>) {
    this.config = { ...this.config, ...updates };
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.config.bgmVolume;
    }
  }

  loadSchedule(schedule: PlaybackScheduleItem[]) {
    this.clearSchedule();
    this.schedule = schedule;
  }

  startFromTime(currentTime: number) {
    if (!this.config.enabled) return;
    this.clearSchedule();

    for (const item of this.schedule) {
      const delay = (item.timeOffset - currentTime) * 1000;
      if (delay < 0) continue; // already past

      const timeout = setTimeout(() => {
        this.triggerCue(item);
      }, delay);
      this.scheduledTimeouts.push(timeout);
    }
  }

  private triggerCue(item: PlaybackScheduleItem) {
    if (!this.config.enabled || !this.assetResolver) return;

    const url = this.assetResolver(item.tag.id, item.tag.type);
    if (!url) return;

    if (item.tag.type === 'sfx') {
      this.playSfx(url);
    } else {
      this.handleBgm(url, item.tag.action);
    }
  }

  private playSfx(url: string) {
    if (this.sfxAudio) {
      this.sfxAudio.pause();
      this.sfxAudio.currentTime = 0;
    }
    this.sfxAudio = new Audio(url);
    this.sfxAudio.volume = this.config.sfxVolume;
    this.sfxAudio.play().catch(() => { /* user hasn't interacted yet */ });
  }

  private handleBgm(url: string, action: string) {
    if (action === 'stop') {
      this.fadeOut(this.bgmAudio, this.config.crossfadeDuration);
      return;
    }

    if (action === 'crossfade' && this.bgmAudio) {
      this.fadeOut(this.bgmAudio, this.config.crossfadeDuration);
    }

    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0;
    this.bgmFadeAudio = this.bgmAudio;
    this.bgmAudio = audio;
    audio.play().catch(() => { /* user hasn't interacted yet */ });
    this.fadeIn(audio, this.config.bgmVolume, this.config.crossfadeDuration);
  }

  /** Duck BGM volume during TTS speech */
  duck() {
    if (this.bgmAudio && this.config.enabled) {
      this.bgmAudio.volume = this.config.bgmVolume * this.config.duckingLevel;
    }
  }

  /** Restore BGM volume after TTS speech */
  unduck() {
    if (this.bgmAudio && this.config.enabled) {
      this.bgmAudio.volume = this.config.bgmVolume;
    }
  }

  private fadeIn(audio: HTMLAudioElement, targetVolume: number, duration: number) {
    const steps = 20;
    const interval = (duration * 1000) / steps;
    const increment = targetVolume / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= targetVolume) {
        audio.volume = targetVolume;
        clearInterval(timer);
        return;
      }
      audio.volume = current;
    }, interval);
  }

  private fadeOut(audio: HTMLAudioElement | null, duration: number) {
    if (!audio) return;
    const steps = 20;
    const interval = (duration * 1000) / steps;
    const startVolume = audio.volume;
    const decrement = startVolume / steps;
    let current = startVolume;
    const timer = setInterval(() => {
      current -= decrement;
      if (current <= 0) {
        audio.volume = 0;
        audio.pause();
        clearInterval(timer);
        return;
      }
      audio.volume = current;
    }, interval);
  }

  private clearSchedule() {
    for (const t of this.scheduledTimeouts) clearTimeout(t);
    this.scheduledTimeouts = [];
  }

  destroy() {
    this.clearSchedule();
    this.sfxAudio?.pause();
    this.bgmAudio?.pause();
    this.bgmFadeAudio?.pause();
    this.sfxAudio = null;
    this.bgmAudio = null;
    this.bgmFadeAudio = null;
  }
}
