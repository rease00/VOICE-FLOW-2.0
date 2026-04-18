import { create } from "zustand";

/* ── Types ────────────────────────────────────────────── */

export type SettingsSection =
  | "profile"
  | "appearance"
  | "audio"
  | "privacy"
  | "subscription"
  | "notifications"
  | "developer";

export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "aurora" | "ocean" | "sunset" | "emerald" | "rose";
export type UiDensity = "comfortable" | "compact";

export interface AppearanceSettings {
  theme: ThemeMode;
  accent: AccentColor;
  density: UiDensity;
}

export interface AudioDefaults {
  defaultSpeed: number;
  defaultVoiceId: string;
  autoPlay: boolean;
  downloadFormat: "mp3" | "wav" | "ogg";
}

export interface PrivacySettings {
  analyticsOptIn: boolean;
  crashReportsOptIn: boolean;
  publicProfile: boolean;
}

export interface NotificationSettings {
  emailDigest: boolean;
  generationComplete: boolean;
  weeklyUsage: boolean;
  productUpdates: boolean;
}

/* ── State + Actions ──────────────────────────────────── */

interface SettingsState {
  section: SettingsSection;
  appearance: AppearanceSettings;
  audio: AudioDefaults;
  privacy: PrivacySettings;
  notifications: NotificationSettings;
  saving: boolean;
  dirty: boolean;
}

interface SettingsActions {
  setSection: (s: SettingsSection) => void;
  setAppearance: (patch: Partial<AppearanceSettings>) => void;
  setAudio: (patch: Partial<AudioDefaults>) => void;
  setPrivacy: (patch: Partial<PrivacySettings>) => void;
  setNotifications: (patch: Partial<NotificationSettings>) => void;
  setSaving: (v: boolean) => void;
  markClean: () => void;
  reset: () => void;
}

/* ── Defaults ─────────────────────────────────────────── */

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "system",
  accent: "aurora",
  density: "comfortable",
};

const DEFAULT_AUDIO: AudioDefaults = {
  defaultSpeed: 1.0,
  defaultVoiceId: "",
  autoPlay: true,
  downloadFormat: "mp3",
};

const DEFAULT_PRIVACY: PrivacySettings = {
  analyticsOptIn: true,
  crashReportsOptIn: true,
  publicProfile: false,
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  emailDigest: true,
  generationComplete: true,
  weeklyUsage: false,
  productUpdates: true,
};

const INITIAL_STATE: SettingsState = {
  section: "profile",
  appearance: DEFAULT_APPEARANCE,
  audio: DEFAULT_AUDIO,
  privacy: DEFAULT_PRIVACY,
  notifications: DEFAULT_NOTIFICATIONS,
  saving: false,
  dirty: false,
};

/* ── Store ─────────────────────────────────────────────── */

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => ({
  ...INITIAL_STATE,

  setSection: (section) => set({ section }),

  setAppearance: (patch) =>
    set((s) => ({ appearance: { ...s.appearance, ...patch }, dirty: true })),

  setAudio: (patch) =>
    set((s) => ({ audio: { ...s.audio, ...patch }, dirty: true })),

  setPrivacy: (patch) =>
    set((s) => ({ privacy: { ...s.privacy, ...patch }, dirty: true })),

  setNotifications: (patch) =>
    set((s) => ({ notifications: { ...s.notifications, ...patch }, dirty: true })),

  setSaving: (saving) => set({ saving }),

  markClean: () => set({ dirty: false }),

  reset: () => set(INITIAL_STATE),
}));

/* ── Selectors ────────────────────────────────────────── */

export const selectIsDirty = (s: SettingsState) => s.dirty;
export const selectIsSaving = (s: SettingsState) => s.saving;
