"use client";

import {
  User,
  Palette,
  Volume2,
  Shield,
  CreditCard,
  Bell,
  Code,
  Check,
  Save,
} from "lucide-react";
import { cn } from "@/ui/cn";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import {
  useSettingsStore,
  type SettingsSection,
  type ThemeMode,
  type AccentColor,
  type UiDensity,
} from "./settingsStore";

/* ── Sidebar ─────────────────────────────────────────── */

const NAV: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "profile",       label: "Profile",       icon: <User className="h-4 w-4" /> },
  { id: "appearance",    label: "Appearance",    icon: <Palette className="h-4 w-4" /> },
  { id: "audio",         label: "Audio",         icon: <Volume2 className="h-4 w-4" /> },
  { id: "privacy",       label: "Privacy",       icon: <Shield className="h-4 w-4" /> },
  { id: "subscription",  label: "Subscription",  icon: <CreditCard className="h-4 w-4" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="h-4 w-4" /> },
  { id: "developer",     label: "Developer",     icon: <Code className="h-4 w-4" /> },
];

function Sidebar({
  active,
  onChange,
}: {
  active: SettingsSection;
  onChange: (s: SettingsSection) => void;
}) {
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto border-b border-white/10 pb-3 md:flex-col md:border-b-0 md:border-r md:pr-4 md:pb-0">
      {NAV.map((n) => (
        <button
          key={n.id}
          onClick={() => onChange(n.id)}
          className={cn(
            "flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-all",
            active === n.id
              ? "bg-[var(--aurora-1)]/15 text-[var(--aurora-1)]"
              : "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)]",
          )}
        >
          {n.icon}
          {n.label}
        </button>
      ))}
    </nav>
  );
}

/* ── Toggle row ──────────────────────────────────────── */

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5">
      <div>
        <p className="text-sm font-medium text-[var(--vf-color-text-primary)]">{label}</p>
        {description && (
          <p className="text-xs text-[var(--vf-color-text-muted)]">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-[var(--aurora-1)]" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

/* ── Select row ──────────────────────────────────────── */

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-3 py-2.5">
      <p className="text-sm font-medium text-[var(--vf-color-text-primary)]">{label}</p>
      <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              value === o.value
                ? "bg-[var(--aurora-1)]/20 text-[var(--aurora-1)]"
                : "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Color swatch picker ─────────────────────────────── */

const ACCENT_COLORS: { id: AccentColor; color: string; label: string }[] = [
  { id: "aurora",  color: "bg-gradient-to-br from-[#7C5CFF] to-[#E040FB]", label: "Aurora" },
  { id: "ocean",   color: "bg-gradient-to-br from-[#0EA5E9] to-[#6366F1]", label: "Ocean" },
  { id: "sunset",  color: "bg-gradient-to-br from-[#F97316] to-[#EF4444]", label: "Sunset" },
  { id: "emerald", color: "bg-gradient-to-br from-[#10B981] to-[#059669]", label: "Emerald" },
  { id: "rose",    color: "bg-gradient-to-br from-[#F43F5E] to-[#DB2777]", label: "Rose" },
];

/* ── Section panels ──────────────────────────────────── */

function ProfilePanel() {
  return (
    <Card elevation={1} className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--vf-color-text-primary)]">Profile</h3>
      <p className="text-xs text-[var(--vf-color-text-muted)]">
        Profile settings are managed from the Profile page.
      </p>
      <a
        href="/app/profile"
        className="inline-flex items-center gap-1 text-sm font-medium text-[var(--aurora-1)] hover:underline"
      >
        Go to Profile →
      </a>
    </Card>
  );
}

function AppearancePanel() {
  const { theme, accent, density } = useSettingsStore((s) => s.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);

  return (
    <Card elevation={1} className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--vf-color-text-primary)]">Appearance</h3>

      <SelectRow<ThemeMode>
        label="Theme"
        value={theme}
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={(v) => setAppearance({ theme: v })}
      />

      <div className="px-3">
        <p className="mb-2 text-sm font-medium text-[var(--vf-color-text-primary)]">Accent</p>
        <div className="flex gap-2">
          {ACCENT_COLORS.map((ac) => (
            <button
              key={ac.id}
              onClick={() => setAppearance({ accent: ac.id })}
              aria-label={ac.label}
              className={cn(
                "relative h-8 w-8 rounded-full transition-transform hover:scale-110",
                ac.color,
                accent === ac.id && "ring-2 ring-white ring-offset-2 ring-offset-[var(--vf-color-bg)]",
              )}
            >
              {accent === ac.id && (
                <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>
      </div>

      <SelectRow<UiDensity>
        label="Density"
        value={density}
        options={[
          { value: "comfortable", label: "Comfortable" },
          { value: "compact", label: "Compact" },
        ]}
        onChange={(v) => setAppearance({ density: v })}
      />
    </Card>
  );
}

function AudioPanel() {
  const audio = useSettingsStore((s) => s.audio);
  const setAudio = useSettingsStore((s) => s.setAudio);

  return (
    <Card elevation={1} className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--vf-color-text-primary)]">Audio Defaults</h3>

      <SelectRow
        label="Speed"
        value={String(audio.defaultSpeed)}
        options={[
          { value: "0.75", label: "0.75×" },
          { value: "1", label: "1×" },
          { value: "1.25", label: "1.25×" },
          { value: "1.5", label: "1.5×" },
          { value: "2", label: "2×" },
        ]}
        onChange={(v) => setAudio({ defaultSpeed: parseFloat(v) })}
      />

      <ToggleRow
        label="Auto-play"
        description="Automatically play audio after generation completes"
        checked={audio.autoPlay}
        onChange={(v) => setAudio({ autoPlay: v })}
      />

      <SelectRow
        label="Download format"
        value={audio.downloadFormat}
        options={[
          { value: "mp3", label: "MP3" },
          { value: "wav", label: "WAV" },
          { value: "ogg", label: "OGG" },
        ]}
        onChange={(v) => setAudio({ downloadFormat: v as "mp3" | "wav" | "ogg" })}
      />
    </Card>
  );
}

function PrivacyPanel() {
  const privacy = useSettingsStore((s) => s.privacy);
  const setPrivacy = useSettingsStore((s) => s.setPrivacy);

  return (
    <Card elevation={1} className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--vf-color-text-primary)]">Privacy</h3>
      <ToggleRow
        label="Analytics"
        description="Help improve Voice-Flow by sharing anonymous usage data"
        checked={privacy.analyticsOptIn}
        onChange={(v) => setPrivacy({ analyticsOptIn: v })}
      />
      <ToggleRow
        label="Crash reports"
        description="Automatically send error reports to help fix bugs"
        checked={privacy.crashReportsOptIn}
        onChange={(v) => setPrivacy({ crashReportsOptIn: v })}
      />
      <ToggleRow
        label="Public profile"
        description="Allow others to see your profile and published works"
        checked={privacy.publicProfile}
        onChange={(v) => setPrivacy({ publicProfile: v })}
      />
    </Card>
  );
}

function SubscriptionPanel() {
  return (
    <Card elevation={1} className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--vf-color-text-primary)]">Subscription</h3>
      <p className="text-xs text-[var(--vf-color-text-muted)]">
        Manage your plan, billing, and invoices.
      </p>
      <a
        href="/app/billing"
        className="inline-flex items-center gap-1 text-sm font-medium text-[var(--aurora-1)] hover:underline"
      >
        Go to Billing →
      </a>
    </Card>
  );
}

function NotificationsPanel() {
  const notifications = useSettingsStore((s) => s.notifications);
  const setNotifications = useSettingsStore((s) => s.setNotifications);

  return (
    <Card elevation={1} className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--vf-color-text-primary)]">Notifications</h3>
      <ToggleRow
        label="Email digest"
        description="Weekly summary of your activity"
        checked={notifications.emailDigest}
        onChange={(v) => setNotifications({ emailDigest: v })}
      />
      <ToggleRow
        label="Generation complete"
        description="Get notified when long-running generations finish"
        checked={notifications.generationComplete}
        onChange={(v) => setNotifications({ generationComplete: v })}
      />
      <ToggleRow
        label="Weekly usage report"
        description="Token usage and trends sent weekly"
        checked={notifications.weeklyUsage}
        onChange={(v) => setNotifications({ weeklyUsage: v })}
      />
      <ToggleRow
        label="Product updates"
        description="New features, improvements, and announcements"
        checked={notifications.productUpdates}
        onChange={(v) => setNotifications({ productUpdates: v })}
      />
    </Card>
  );
}

function DeveloperPanel() {
  return (
    <Card elevation={1} className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--vf-color-text-primary)]">Developer</h3>
      <p className="text-xs text-[var(--vf-color-text-muted)]">
        API keys and webhook configuration — coming soon.
      </p>
    </Card>
  );
}

const PANELS: Record<SettingsSection, React.ComponentType> = {
  profile: ProfilePanel,
  appearance: AppearancePanel,
  audio: AudioPanel,
  privacy: PrivacyPanel,
  subscription: SubscriptionPanel,
  notifications: NotificationsPanel,
  developer: DeveloperPanel,
};

/* ── Main ─────────────────────────────────────────────── */

export function SettingsPageV2() {
  const section = useSettingsStore((s) => s.section);
  const dirty = useSettingsStore((s) => s.dirty);
  const saving = useSettingsStore((s) => s.saving);
  const setSection = useSettingsStore((s) => s.setSection);
  const markClean = useSettingsStore((s) => s.markClean);

  const Panel = PANELS[section];

  const handleSave = () => {
    // In production, this would persist to Firestore / API
    useSettingsStore.getState().setSaving(true);
    setTimeout(() => {
      useSettingsStore.getState().setSaving(false);
      markClean();
    }, 600);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--vf-color-text-primary)]">Settings</h1>
          <p className="text-sm text-[var(--vf-color-text-muted)]">
            Customize your Voice-Flow experience
          </p>
        </div>
        {dirty && (
          <Button
            variant="aurora"
            size="sm"
            leftIcon={<Save className="h-4 w-4" />}
            loading={saving}
            onClick={handleSave}
          >
            Save changes
          </Button>
        )}
      </div>

      {/* Layout */}
      <div className="flex flex-col gap-6 md:flex-row">
        <Sidebar active={section} onChange={setSection} />
        <div className="flex-1">
          <Panel />
        </div>
      </div>
    </div>
  );
}
