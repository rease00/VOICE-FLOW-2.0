/**
 * settingsStore.test.ts
 *
 * Contract tests for the settingsStore Zustand slice.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, selectIsDirty, selectIsSaving } from "../src/features/settings/v2/settingsStore";

beforeEach(() => {
  useSettingsStore.getState().reset();
});

/* ── Initial state ───────────────────────────────────── */

describe("settingsStore — initial state", () => {
  it("section defaults to profile", () => {
    expect(useSettingsStore.getState().section).toBe("profile");
  });

  it("dirty is false", () => {
    expect(useSettingsStore.getState().dirty).toBe(false);
  });

  it("saving is false", () => {
    expect(useSettingsStore.getState().saving).toBe(false);
  });

  it("appearance has system theme", () => {
    expect(useSettingsStore.getState().appearance.theme).toBe("system");
  });

  it("appearance has aurora accent", () => {
    expect(useSettingsStore.getState().appearance.accent).toBe("aurora");
  });

  it("audio defaultSpeed is 1.0", () => {
    expect(useSettingsStore.getState().audio.defaultSpeed).toBe(1.0);
  });

  it("audio autoPlay is true", () => {
    expect(useSettingsStore.getState().audio.autoPlay).toBe(true);
  });

  it("privacy analyticsOptIn is true", () => {
    expect(useSettingsStore.getState().privacy.analyticsOptIn).toBe(true);
  });

  it("notifications emailDigest is true", () => {
    expect(useSettingsStore.getState().notifications.emailDigest).toBe(true);
  });
});

/* ── Section navigation ──────────────────────────────── */

describe("settingsStore — setSection", () => {
  it("sets section to appearance", () => {
    useSettingsStore.getState().setSection("appearance");
    expect(useSettingsStore.getState().section).toBe("appearance");
  });

  it("sets section to developer", () => {
    useSettingsStore.getState().setSection("developer");
    expect(useSettingsStore.getState().section).toBe("developer");
  });
});

/* ── Appearance ──────────────────────────────────────── */

describe("settingsStore — appearance", () => {
  it("sets theme to dark", () => {
    useSettingsStore.getState().setAppearance({ theme: "dark" });
    expect(useSettingsStore.getState().appearance.theme).toBe("dark");
  });

  it("sets accent to ocean without clobbering theme", () => {
    useSettingsStore.getState().setAppearance({ theme: "dark" });
    useSettingsStore.getState().setAppearance({ accent: "ocean" });
    const { theme, accent } = useSettingsStore.getState().appearance;
    expect(theme).toBe("dark");
    expect(accent).toBe("ocean");
  });

  it("marks dirty on change", () => {
    useSettingsStore.getState().setAppearance({ density: "compact" });
    expect(useSettingsStore.getState().dirty).toBe(true);
  });
});

/* ── Audio ────────────────────────────────────────────── */

describe("settingsStore — audio", () => {
  it("sets defaultSpeed", () => {
    useSettingsStore.getState().setAudio({ defaultSpeed: 1.5 });
    expect(useSettingsStore.getState().audio.defaultSpeed).toBe(1.5);
  });

  it("sets downloadFormat", () => {
    useSettingsStore.getState().setAudio({ downloadFormat: "wav" });
    expect(useSettingsStore.getState().audio.downloadFormat).toBe("wav");
  });

  it("toggles autoPlay", () => {
    useSettingsStore.getState().setAudio({ autoPlay: false });
    expect(useSettingsStore.getState().audio.autoPlay).toBe(false);
  });
});

/* ── Privacy ──────────────────────────────────────────── */

describe("settingsStore — privacy", () => {
  it("opts out of analytics", () => {
    useSettingsStore.getState().setPrivacy({ analyticsOptIn: false });
    expect(useSettingsStore.getState().privacy.analyticsOptIn).toBe(false);
  });

  it("enables public profile", () => {
    useSettingsStore.getState().setPrivacy({ publicProfile: true });
    expect(useSettingsStore.getState().privacy.publicProfile).toBe(true);
  });
});

/* ── Notifications ────────────────────────────────────── */

describe("settingsStore — notifications", () => {
  it("disables email digest", () => {
    useSettingsStore.getState().setNotifications({ emailDigest: false });
    expect(useSettingsStore.getState().notifications.emailDigest).toBe(false);
  });

  it("enables weekly usage", () => {
    useSettingsStore.getState().setNotifications({ weeklyUsage: true });
    expect(useSettingsStore.getState().notifications.weeklyUsage).toBe(true);
  });
});

/* ── Dirty / Saving ──────────────────────────────────── */

describe("settingsStore — dirty/saving lifecycle", () => {
  it("markClean resets dirty flag", () => {
    useSettingsStore.getState().setAppearance({ theme: "dark" });
    expect(useSettingsStore.getState().dirty).toBe(true);
    useSettingsStore.getState().markClean();
    expect(useSettingsStore.getState().dirty).toBe(false);
  });

  it("setSaving toggles saving flag", () => {
    useSettingsStore.getState().setSaving(true);
    expect(useSettingsStore.getState().saving).toBe(true);
    useSettingsStore.getState().setSaving(false);
    expect(useSettingsStore.getState().saving).toBe(false);
  });
});

/* ── Selectors ────────────────────────────────────────── */

describe("settingsStore — selectors", () => {
  it("selectIsDirty false initially", () => {
    expect(selectIsDirty(useSettingsStore.getState())).toBe(false);
  });

  it("selectIsDirty true after change", () => {
    useSettingsStore.getState().setAudio({ defaultSpeed: 2 });
    expect(selectIsDirty(useSettingsStore.getState())).toBe(true);
  });

  it("selectIsSaving false initially", () => {
    expect(selectIsSaving(useSettingsStore.getState())).toBe(false);
  });
});

/* ── Reset ────────────────────────────────────────────── */

describe("settingsStore — reset", () => {
  it("resets everything to defaults", () => {
    useSettingsStore.getState().setSection("developer");
    useSettingsStore.getState().setAppearance({ theme: "dark", accent: "rose" });
    useSettingsStore.getState().setAudio({ defaultSpeed: 2 });
    useSettingsStore.getState().setSaving(true);
    useSettingsStore.getState().reset();

    const s = useSettingsStore.getState();
    expect(s.section).toBe("profile");
    expect(s.appearance.theme).toBe("system");
    expect(s.appearance.accent).toBe("aurora");
    expect(s.audio.defaultSpeed).toBe(1.0);
    expect(s.saving).toBe(false);
    expect(s.dirty).toBe(false);
  });
});
