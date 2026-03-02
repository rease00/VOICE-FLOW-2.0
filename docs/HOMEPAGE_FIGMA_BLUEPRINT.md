# VoiceFlow Homepage Blueprint (Dark Mode)

This blueprint is tailored to your current app visual language (`deep navy + cyan/violet glow`, left rail, top command bar, floating FAB, studio-style cards).  
Use this directly to build a new Home page in Figma.

## 1) Design Direction (Professional + On-Brand)

- Tone: `AI audio studio control center` (clean, technical, premium)
- Keep:
  - Left navigation rail (`256px` desktop)
  - Top command/status bar
  - Glass-like dark surfaces with subtle cyan/violet highlights
  - Rounded corners and low-noise gradients
- Improve:
  - Strong first-fold hierarchy (headline + primary actions)
  - Clear KPI cards (balance, generation usage, runtime health)
  - Faster task entry (Generate, Video Dub, Novel, Voice Lab)
  - Better empty/idle states and progressive disclosure

## 2) Frame Setup

- Desktop: `1440 x 1024`
- Laptop: `1280 x 800`
- Tablet: `1024 x 1366`
- Mobile: `390 x 844`
- Layout grid:
  - Desktop/Laptop: 12-column, `24px` margins, `20px` gutters
  - Tablet: 8-column, `20px` margins, `16px` gutters
  - Mobile: 4-column, `16px` margins, `12px` gutters

## 3) Token Mapping (use existing app tokens)

From current app token system:
- Background: `--vf-color-bg`, `--vf-color-bg-deep`
- Surface: `--vf-color-surface`, `--vf-color-surface-2`
- Border: `--vf-color-border`
- Text: `--vf-color-text`, `--vf-color-text-muted`
- Accent: `--vf-color-accent` (teal/cyan family)
- Radius scale: `--vf-radius-sm/md/lg/xl`
- Motion: `--vf-motion-fast/base/slow`

## 4) Homepage Information Architecture

## A. Top Fold (Hero + Actions)
- Left: 
  - H1: `Create broadcast-ready voice content`
  - Subtitle: one line about Studio, Novel, Dub workflow
  - Primary CTA: `Open Studio`
  - Secondary CTA: `Start Video Dub`
- Right:
  - Runtime health mini panel:
    - `Prime Runtime`, `Basic Runtime`, `Queue`
    - status chips (`online/warn/offline`)

## B. KPI Row
- Card 1: `AUDIT Balance`
- Card 2: `Daily Usage`
- Card 3: `Generations This Week`
- Card 4: `Avg Render Time`
- All cards same height, icon + value + micro-trend

## C. Quick Start Tiles (Task Launchers)
- 4 tiles:
  - `Studio Voice`
  - `Novel Workspace`
  - `Video Dub`
  - `Voice Lab`
- Each tile:
  - icon
  - one-line description
  - CTA button

## D. Recent Activity + Drafts
- Left column: `Recent Generations`
- Right column: `Recent Drafts`
- Empty state:
  - icon
  - single line message
  - `Create first project`

## E. Sticky Utility (Desktop only)
- Keep current telemetry strip low-profile
- Keep floating assistant FAB at bottom-right with safe spacing

## 5) Spacing + Sizing Rules

- Page content max width: `1140px` (aligned to current studio)
- Vertical rhythm:
  - Section gap: `20–24px`
  - Card inner padding: `16–20px`
  - Heading-to-content gap: `8–12px`
- Border radius:
  - Main cards: `20–24px`
  - Buttons/chips: `10–14px`

## 6) Interaction + Motion

- Hover:
  - Card: `translateY(-1px)` + slightly brighter border
  - Button: slight brightness/saturation boost
- Entrance:
  - Stagger cards (`40ms` incremental)
  - Duration: `220–320ms`
- Reduce motion mode:
  - Disable shimmer/pulse loops
  - Keep instant state feedback only

## 7) Responsive Behavior

- Desktop (`>=1280`):
  - Left rail fixed
  - Hero 2-column
  - KPI 4-up
- Tablet (`768–1279`):
  - Hero stacked
  - KPI 2x2
  - Quick Start 2x2
- Mobile (`<768`):
  - No dense telemetry
  - Single column sections
  - Floating controls respect safe-area

## 8) Generate Button Placement Rule (Aspect-Ratio Aware)

For Studio floating generate dock, use:
- Mobile: centered, `bottom = safe-area + 1rem`
- `md+`: center to workspace (`left: calc(50% + 8rem)`), not viewport
- Short-height screens (`h <= 820`): raise bottom offset to avoid overlap with telemetry/FAB

This matches the recent responsive anchor logic already implemented in code.

## 9) Figma Build Checklist

- Create page: `Homepage v1 (Dark)`
- Add frames: Desktop/Laptop/Tablet/Mobile
- Build components first:
  - Top bar
  - Sidebar
  - KPI card
  - Quick tile
  - Status chip
  - Activity row
- Apply tokens and auto-layout constraints
- Validate text contrast against dark surfaces
- Create prototype links for all primary CTAs

## 10) Ready-to-Implement Component List

- `HomeHeroPanel`
- `RuntimeHealthCard`
- `KpiStatCard` (4 variants)
- `QuickStartTile` (4 variants)
- `RecentGenerationList`
- `RecentDraftList`
- `EmptyStateCard`
