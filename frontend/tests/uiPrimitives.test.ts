import { describe, it, expect } from "vitest";

// ── barrel export contract ───────────────────────────────────────
// Ensures every primitive is re-exported from the barrel and no
// exports silently disappear during refactors.

import * as UI from "../src/ui/index";

const EXPECTED_COMPONENTS = [
  "Avatar",
  "Badge",
  "Button",
  "Card",
  "Chip",
  "Dialog",
  "DialogClose",
  "EmptyState",
  "GlassPanel",
  "IconButton",
  "Input",
  "Kbd",
  "Popover",
  "PopoverClose",
  "ProgressRing",
  "Select",
  "Sheet",
  "SheetClose",
  "Skeleton",
  "Slider",
  "Spinner",
  "Switch",
  "Tabs",
  "Textarea",
  "Tooltip",
  "TooltipProvider",
] as const;

const EXPECTED_UTILITIES = [
  "cn",
  "spring",
  "fadeIn",
  "sheetUp",
  "scaleIn",
] as const;

describe("src/ui barrel exports", () => {
  it.each(EXPECTED_COMPONENTS)(
    "exports %s component",
    (name) => {
      expect(UI).toHaveProperty(name);
      const val = (UI as Record<string, unknown>)[name];
      // forwardRef components are objects with $$typeof, plain components are functions
      const isComponent = typeof val === "function" || (typeof val === "object" && val !== null && "$$typeof" in val);
      expect(isComponent).toBe(true);
    },
  );

  it.each(EXPECTED_UTILITIES)(
    "exports %s utility",
    (name) => {
      expect(UI).toHaveProperty(name);
    },
  );

  it("does not accidentally leak extra top-level exports", () => {
    const actual = Object.keys(UI).sort();
    const expected = [...EXPECTED_COMPONENTS, ...EXPECTED_UTILITIES].sort();
    expect(actual).toEqual(expected);
  });
});

// ── ProgressRing math contract ───────────────────────────────────
import { ProgressRing } from "../src/ui/ProgressRing";

describe("ProgressRing", () => {
  it("is a function component", () => {
    expect(typeof ProgressRing).toBe("function");
  });
});

// ── cn utility ───────────────────────────────────────────────────
import { cn } from "../src/ui/cn";

describe("cn", () => {
  it("merges class strings", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "extra")).toBe("base extra");
  });

  it("deduplicates conflicting Tailwind utilities", () => {
    expect(cn("text-sm text-lg")).toBe("text-lg");
  });
});

// ── motion presets ───────────────────────────────────────────────
import { spring, fadeIn, scaleIn, sheetUp } from "../src/ui/motion";

describe("motion presets", () => {
  it("spring.press is a spring transition", () => {
    expect(spring.press).toHaveProperty("type", "spring");
    expect(spring.press).toHaveProperty("stiffness");
    expect(spring.press).toHaveProperty("damping");
  });

  it("fadeIn has initial/animate/exit keys", () => {
    expect(fadeIn).toHaveProperty("initial");
    expect(fadeIn).toHaveProperty("animate");
    expect(fadeIn).toHaveProperty("exit");
  });

  it("scaleIn starts slightly scaled down", () => {
    expect((scaleIn.initial as { scale: number }).scale).toBeLessThan(1);
  });

  it("sheetUp slides from below", () => {
    expect((sheetUp.initial as { y: number }).y).toBeGreaterThan(0);
  });
});

// ── Badge variant contract ───────────────────────────────────────
import { Badge } from "../src/ui/Badge";

describe("Badge", () => {
  it("is a function component", () => {
    expect(typeof Badge).toBe("function");
  });
});

// ── EmptyState contract ──────────────────────────────────────────
import { EmptyState } from "../src/ui/EmptyState";

describe("EmptyState", () => {
  it("is a function component", () => {
    expect(typeof EmptyState).toBe("function");
  });
});

// ── Skeleton contract ────────────────────────────────────────────
import { Skeleton } from "../src/ui/Skeleton";

describe("Skeleton", () => {
  it("is a function component", () => {
    expect(typeof Skeleton).toBe("function");
  });
});

// ── Spinner contract ─────────────────────────────────────────────
import { Spinner } from "../src/ui/Spinner";

describe("Spinner", () => {
  it("is a function component", () => {
    expect(typeof Spinner).toBe("function");
  });
});

// ── Kbd contract ─────────────────────────────────────────────────
import { Kbd } from "../src/ui/Kbd";

describe("Kbd", () => {
  it("is a function component", () => {
    expect(typeof Kbd).toBe("function");
  });
});
