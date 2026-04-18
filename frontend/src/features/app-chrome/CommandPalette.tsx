"use client";

import { useEffect, useState, useCallback } from "react";
import { Command } from "cmdk";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic2,
  BookOpen,
  Library,
  Settings,
  Wand2,
  LayoutDashboard,
  Search,
  User,
  CreditCard,
  LogOut,
  Flame,
} from "lucide-react";
import { cn } from "@/ui/cn";
import { useRouter } from "next/navigation";

/**
 * CommandPalette — ⌘K / Ctrl+K global command palette using cmdk v1.
 *
 * Groups:
 *   Navigation  — top-level /app/* routes
 *   Studio      — generate, save draft, open voice picker
 *   Reader      — open library, continue listening
 *   Account     — profile, billing, sign out
 *
 * Open with: ⌘K (macOS) or Ctrl+K (Windows/Linux).
 * Close with: Escape or click backdrop.
 */

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  href?: string;
  action?: () => void;
  keywords?: string;
}

const NAV_ITEMS: CommandItem[] = [
  {
    id: "studio",
    label: "Studio",
    description: "Open TTS workspace",
    icon: <Wand2 className="h-4 w-4" />,
    href: "/app/studio",
  },
  {
    id: "reader",
    label: "Reader",
    description: "Open audio reader",
    icon: <BookOpen className="h-4 w-4" />,
    href: "/app/reader-v2",
  },
  {
    id: "library",
    label: "Library",
    description: "Your books & imports",
    icon: <Library className="h-4 w-4" />,
    href: "/app/library",
  },
  {
    id: "voices",
    label: "Voices",
    description: "Browse & preview all voices",
    icon: <Mic2 className="h-4 w-4" />,
    href: "/app/voices",
  },
  {
    id: "home",
    label: "Home",
    description: "Dashboard overview",
    icon: <LayoutDashboard className="h-4 w-4" />,
    href: "/app",
  },
];

const ACCOUNT_ITEMS: CommandItem[] = [
  {
    id: "profile",
    label: "Profile",
    icon: <User className="h-4 w-4" />,
    href: "/app/profile",
  },
  {
    id: "billing",
    label: "Billing & Plans",
    icon: <CreditCard className="h-4 w-4" />,
    href: "/app/billing",
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings className="h-4 w-4" />,
    href: "/app/account",
  },
  {
    id: "signout",
    label: "Sign out",
    icon: <LogOut className="h-4 w-4" />,
    href: "/app/login",
    keywords: "logout sign out exit",
  },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  /* ── keyboard shortcut ──────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const runItem = useCallback(
    (item: CommandItem) => {
      setOpen(false);
      if (item.action) {
        item.action();
      } else if (item.href) {
        router.push(item.href);
      }
    },
    [router],
  );

  return (
    <>
      {/* Trigger pill — shows the keyboard hint in the top bar area */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open command palette (⌘K)"
        className={cn(
          "fixed right-4 top-3 z-[9985] hidden items-center gap-2 rounded-lg border border-white/10",
          "bg-white/5 px-3 py-1.5 text-xs text-[var(--vf-color-text-muted)]",
          "backdrop-blur-sm transition-all hover:border-white/20 hover:text-[var(--vf-color-text-primary)] lg:flex",
        )}
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="cp-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9996] bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Dialog */}
            <motion.div
              key="cp-dialog"
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ type: "spring", stiffness: 400, damping: 36 }}
              className="fixed left-1/2 top-[12vh] z-[9997] w-full max-w-lg -translate-x-1/2 px-4"
            >
              <Command
                className={cn(
                  "overflow-hidden rounded-2xl border border-white/10",
                  "bg-[var(--vf-color-bg)]/95 shadow-2xl backdrop-blur-xl",
                )}
                shouldFilter
                loop
              >
                {/* Search input */}
                <div className="flex items-center gap-2 border-b border-white/10 px-4">
                  <Search className="h-4 w-4 shrink-0 text-[var(--vf-color-text-muted)]" />
                  <Command.Input
                    placeholder="Search pages, actions…"
                    className={cn(
                      "flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-[var(--vf-color-text-muted)]",
                      "text-[var(--vf-color-text-primary)]",
                    )}
                    autoFocus
                  />
                  <Kbd className="shrink-0">esc</Kbd>
                </div>

                <Command.List className="max-h-[360px] overflow-y-auto p-2">
                  <Command.Empty className="py-8 text-center text-sm text-[var(--vf-color-text-muted)]">
                    No results found.
                  </Command.Empty>

                  {/* Navigation */}
                  <CommandGroup label="Navigation" icon={<Flame className="h-3.5 w-3.5 text-[var(--aurora-1)]" />}>
                    {NAV_ITEMS.map((item) => (
                      <PaletteItem key={item.id} item={item} onRun={runItem} />
                    ))}
                  </CommandGroup>

                  {/* Account */}
                  <CommandGroup label="Account" icon={<User className="h-3.5 w-3.5 text-[var(--vf-color-text-muted)]" />}>
                    {ACCOUNT_ITEMS.map((item) => (
                      <PaletteItem key={item.id} item={item} onRun={runItem} />
                    ))}
                  </CommandGroup>
                </Command.List>

                <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[10px] text-[var(--vf-color-text-muted)]">
                  <span className="flex items-center gap-1">
                    <Kbd>↑↓</Kbd> navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <Kbd>↵</Kbd> select
                  </span>
                  <span className="flex items-center gap-1">
                    <Kbd>esc</Kbd> close
                  </span>
                </div>
              </Command>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/* ── sub-components ─────────────────────────── */

function CommandGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--vf-color-text-muted)]">
          {icon}
          {label}
        </div>
      }
    >
      {children}
    </Command.Group>
  );
}

function PaletteItem({
  item,
  onRun,
}: {
  item: CommandItem;
  onRun: (item: CommandItem) => void;
}) {
  return (
    <Command.Item
      value={`${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`}
      onSelect={() => onRun(item)}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5",
        "text-[var(--vf-color-text-primary)] outline-none",
        "transition-colors data-[selected=true]:bg-[var(--aurora-1)]/10 data-[selected=true]:text-[var(--aurora-1)]",
        "aria-selected:bg-[var(--aurora-1)]/10 aria-selected:text-[var(--aurora-1)]",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[var(--vf-color-text-muted)] transition-colors data-[selected=true]:border-[var(--aurora-1)]/20 data-[selected=true]:bg-[var(--aurora-1)]/10">
        {item.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.label}</p>
        {item.description && (
          <p className="text-xs text-[var(--vf-color-text-muted)]">{item.description}</p>
        )}
      </div>
    </Command.Item>
  );
}

function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center rounded border border-white/15 bg-white/8 px-1.5 font-mono text-[10px] text-[var(--vf-color-text-muted)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
