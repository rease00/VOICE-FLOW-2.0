# Performance and Bundle Configuration Audit

**Project:** Voice-Flow (Next.js 16 voice studio application)  
**Date:** 2026-04-13  
**Auditor:** Automated Performance Analysis  
**Related Audits:** [Security](security-audit-2026-04-13.md) | [Test Coverage](test-coverage-audit-2026-04-13.md) | [Code Quality](code-quality-audit-2026-04-13.md)

---

## Executive Summary

The Voice-Flow frontend demonstrates a **well-structured bundle configuration** with comprehensive budget enforcement scripts and asset optimization strategies. The project uses Next.js 16 with Turbopack, standalone output mode, and has sophisticated build-time checks for bundle size monitoring.

**Overall Rating:** ✅ **GOOD** - Minor CSS budget violation, otherwise well-optimized

---

## 1. Bundle Size Analysis

### 1.1 Bundle Budget Configuration

The project defines clear bundle budgets in [`frontend/scripts/bundle-budget.mjs`](frontend/scripts/bundle-budget.mjs):

| Budget Category | Limit | Default Value | Status |
|-----------------|-------|---------------|--------|
| Eager JS Bytes | 400 KB | 409,600 bytes | ✅ Within budget |
| Eager CSS Bytes | 288 KB | 294,912 bytes | ⚠️ **VIOLATION** |
| Eager WASM Bytes | 5 MB | 5,242,880 bytes | ✅ Within budget |
| Browser ML Chunk | 900 KB | 921,600 bytes | ✅ Within budget |
| Main App Chunk | 225 KB | 231,424 bytes | ✅ Within budget |
| Dist Total | 60 MB | 62,914,560 bytes | ✅ Within budget |
| Shipped Audio | 10 MB | 10,485,760 bytes | ✅ Within budget |

### 1.2 Budget Violations

**CSS Budget Violation Detected:**
- **File:** `chunks/031y-8yy83_9_.css`
- **Size:** 326,886 bytes (319 KB)
- **Limit:** 294,912 bytes (288 KB)
- **Overage:** 31,974 bytes (~10% over limit)

```json
// From bundle-budget.json violations array
{
  "file": "chunks/031y-8yy83_9_.css",
  "bucket": "eager",
  "bytes": 326886,
  "maxBytes": 294912
}
```

### 1.3 Bundle Report Summary

From [`frontend/artifacts/bundle-report.json`](frontend/artifacts/bundle-report.json):

- **Total Static Files:** 61 files analyzed
- **Eager Asset Count:** 60 files
- **Eager Asset Bytes:** 3,537,812 bytes (~3.4 MB)
- **Lazy Asset Count:** 0 files (all assets currently eager)
- **Critical Root JS Assets:** 5 files

**Top JS Chunks by Size:**
| Chunk | Size | Type |
|-------|------|------|
| `0djsjovxva91_.js` | 391 KB | Eager |
| `0ogtg~e6byxbo.js` | 391 KB | Eager |
| `07bczh-17.i5i.js` | 297 KB | Eager |
| `12.a92z9qumw5.js` | 236 KB | Eager |
| `16g.ca89g7fib.js` | 222 KB | Eager |

---

## 2. Asset Optimization Assessment

### 2.1 Audio Assets Inventory

Audio assets in [`frontend/public/assets/audio/`](frontend/public/assets/audio/):

**Music Catalog (14 files):**
| File | Size | Notes |
|------|------|-------|
| `autumn_is_coming_piano.mp3` | 7.15 MB | Large ambient track |
| `beyond_horizons.mp3` | 3.61 MB | - |
| `chill_synthwave_80x.mp3` | 4.18 MB | - |
| `cinematic_melody.mp3` | 2.78 MB | - |
| `corporate_upbeat.mp3` | 3.37 MB | - |
| `just_relax.mp3` | 4.89 MB | - |
| `lofi_chill.mp3` | 4.49 MB | - |
| `novel_ambient_pages.mp3` | 6.62 MB | Novel-specific |
| `novel_cinematic_arc.mp3` | 7.37 MB | Novel-specific |
| `novel_comedy_bounce.mp3` | 3.63 MB | Novel-specific |
| `novel_mystery_night.mp3` | 2.78 MB | Novel-specific |
| `novel_romance_glow.mp3` | 2.60 MB | Novel-specific |
| `novel_tension_dark.mp3` | 3.82 MB | Novel-specific |
| `soaring_heights.mp3` | 7.32 MB | Large ambient track |

**Total Music Size:** ~63.83 MB

**SFX Catalog (11 files):**
| File | Size | Notes |
|------|------|-------|
| `applause_cheer.mp3` | 251 KB | - |
| `boost_transition.mp3` | 35 KB | Small |
| `dog_bark.mp3` | 88 KB | - |
| `door_lock.mp3` | 16 KB | Small |
| `door_open_close.mp3` | 38 KB | - |
| `level_up.mp3` | 67 KB | - |
| `light_rain.mp3` | 3.26 MB | ⚠️ Large for SFX |
| `punch_hit.mp3` | 47 KB | - |
| `scream.mp3` | 118 KB | - |
| `sliding_door.mp3` | 95 KB | - |
| `whoosh.mp3` | 18 KB | Small |

**Total SFX Size:** ~4.03 MB

### 2.2 Audio Pruning Strategy

The project implements audio pruning via [`frontend/scripts/prune-bundled-audio.mjs`](frontend/scripts/prune-bundled-audio.mjs):

```javascript
// Prunes music catalog and large ambient SFX from dist
const targets = [
  path.join(DIST_DIR, 'assets', 'audio', 'music'),
  path.join(DIST_DIR, 'assets', 'audio', 'sfx', 'light_rain.mp3'),
];
```

**Assessment:** ✅ **EXCELLENT** - Music catalog and oversized ambient SFX are pruned from production builds, reducing shipped audio from ~68 MB to within the 10 MB budget.

### 2.3 Image Optimization

- Uses [`next/image`](frontend/components/ui/OptimizedAvatar.tsx) for avatar images
- [`OptimizedAvatar`](frontend/components/ui/OptimizedAvatar.tsx:14) component provides:
  - Automatic next/image optimization
  - Blur placeholder support
  - Responsive sizing

### 2.4 Font Loading

- No custom font files detected in public directory
- Uses system font stack via Tailwind CSS
- `antialiased` class applied for font rendering

---

## 3. Build Configuration Review

### 3.1 Build Scripts

From [`frontend/package.json`](frontend/package.json:10):

```json
{
  "build": "next build --turbopack && node scripts/prune-bundled-audio.mjs",
  "bundle:report": "node scripts/bundle-report.mjs",
  "bundle:budget": "node scripts/bundle-budget.mjs",
  "perf:lighthouse": "node scripts/perf-lighthouse.mjs"
}
```

**Assessment:** ✅ **WELL-STRUCTURED**
- Turbopack enabled for faster builds
- Audio pruning integrated into build pipeline
- Separate scripts for bundle analysis and budget checking

### 3.2 Bundle Analysis Scripts

**[`bundle-report.mjs`](frontend/scripts/bundle-report.mjs):**
- Analyzes `.next/static` directory
- Classifies assets as eager/lazy based on manifests
- Extracts WASM references from JS chunks
- Outputs JSON report for CI integration

**[`bundle-budget.mjs`](frontend/scripts/bundle-budget.mjs):**
- Configurable budget limits via environment variables
- Classifies assets into buckets (eager, lazy, critical)
- Reports violations with specific file details
- Exit code indicates pass/fail for CI

**Environment Variables for Budget Configuration:**
- `VF_FRONTEND_EAGER_JS_MAX_BYTES` (default: 409,600)
- `VF_FRONTEND_EAGER_CSS_MAX_BYTES` (default: 294,912)
- `VF_FRONTEND_EAGER_WASM_MAX_BYTES` (default: 5,242,880)
- `VF_FRONTEND_BROWSER_ML_CHUNK_MAX_BYTES` (default: 921,600)
- `VF_FRONTEND_MAIN_APP_CHUNK_MAX_BYTES` (default: 230,400)
- `VF_FRONTEND_DIST_TOTAL_MAX_BYTES` (default: 62,914,560)
- `VF_FRONTEND_DIST_AUDIO_MAX_BYTES` (default: 10,485,760)

---

## 4. Next.js Performance Settings

### 4.1 Configuration Analysis

From [`frontend/next.config.mjs`](frontend/next.config.mjs):

```javascript
const nextConfig = {
  reactStrictMode: true,
  distDir: sanitizedDistDir,
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['sharp'],
  outputFileTracingExcludes: { '/*': [] },
  // Security headers for production
  async headers() { /* HSTS, X-Frame-Options, etc. */ }
};
```

**Performance Features:**
| Setting | Value | Impact |
|---------|-------|--------|
| `output` | `'standalone'` | ✅ Optimized for containerized deployment |
| `reactStrictMode` | `true` | ✅ Development quality checks |
| `serverExternalPackages` | `['sharp']` | ✅ Prevents bundling native modules |
| Turbopack | Enabled | ✅ Faster development builds |

### 4.2 Security Headers (Production)

Headers configured in [`next.config.mjs`](frontend/next.config.mjs:87):
- `Strict-Transport-Security`: HSTS with preload
- `X-Frame-Options`: DENY
- `X-Content-Type-Options`: nosniff
- `Referrer-Policy`: strict-origin-when-cross-origin
- `Permissions-Policy`: Restricts device APIs
- `X-Robots-Tag`: noindex for app routes

### 4.3 Dynamic Imports Strategy

The project uses extensive code splitting via dynamic imports:

**From [`MainApp.tsx`](frontend/src/app/workspace/MainApp.tsx:201):**
```javascript
// Service lazy loading with caching
const loadStudioMixService = (() => {
  let cached = null;
  return () => {
    cached ??= import('../../../services/studioMixService');
    return cached;
  };
})();

// Component lazy loading
const LazyBlockScriptEditor = lazy(async () => {
  const module = await import('../../../components/studio/BlockScriptEditor');
  return { default: module.BlockScriptEditor };
});
```

**Lazy-loaded Components:**
- `AdminTabContent`
- `NovelTabContent`
- `VoiceCloningTabContent`
- `VoiceCloneModal`
- `AudioPlayer`
- `BlockScriptEditor`
- `StudioQueuePanel`
- `AILibrarian` (SSR disabled)
- `ReaderView` (SSR disabled)

**Assessment:** ✅ **EXCELLENT** - Heavy components are lazy-loaded with proper caching to avoid re-fetching.

---

## 5. Performance Metrics Summary

### 5.1 Lighthouse Integration

From [`frontend/artifacts/lighthouse-summary.json`](frontend/artifacts/lighthouse-summary.json):

```json
{
  "generatedAt": "2026-04-06T19:21:54.567Z",
  "targetUrl": "http://127.0.0.1:3000/app/studio",
  "enforce": false,
  "ran": false,
  "passed": true,
  "note": "Skipped. Set VF_ENABLE_LIGHTHOUSE=1 to run Lighthouse locally."
}
```

**Lighthouse Script Features** ([`perf-lighthouse.mjs`](frontend/scripts/perf-lighthouse.mjs)):
- Default targets: `/app/studio`, `/app/voices`, `/app/writing`
- Configurable via `VF_LIGHTHOUSE_URL` and `VF_LIGHTHOUSE_BASE_URL`
- JSON output for CI integration
- Metric extraction: FCP, LCP, TTI, CLS, SI

### 5.2 Bundle Size Trends

| Metric | Current | Budget | Status |
|--------|---------|--------|--------|
| Total Dist Size | 3.5 MB | 60 MB | ✅ Well under |
| Eager JS | ~380 KB/chunk | 400 KB | ✅ Within budget |
| Eager CSS | 319 KB | 288 KB | ⚠️ 10% over |
| Shipped Audio | 0 bytes | 10 MB | ✅ Pruned |

---

## 6. Optimization Recommendations

### 6.1 Critical (Must Fix)

1. **CSS Budget Violation**
   - **Issue:** CSS chunk exceeds budget by 31 KB
   - **Recommendation:** 
     - Audit Tailwind CSS usage for unused classes
     - Consider CSS splitting for route-specific styles
     - Enable Tailwind CSS purging optimization
   - **File:** [`frontend/artifacts/bundle-budget.json`](frontend/artifacts/bundle-budget.json:804)

### 6.2 High Priority (Should Fix)

2. **Large Audio Assets in Source**
   - **Issue:** 68 MB of audio in source, requires pruning
   - **Recommendation:** 
     - Consider CDN hosting for music assets
     - Implement on-demand loading for background music
     - Evaluate audio compression (OPUS/WEBM)
   - **Files:** [`frontend/public/assets/audio/music/`](frontend/public/assets/audio/music/)

3. **Lighthouse Not Running in CI**
   - **Issue:** Lighthouse skipped by default
   - **Recommendation:** Enable `VF_ENABLE_LIGHTHOUSE=1` in CI pipeline
   - **File:** [`frontend/scripts/perf-lighthouse.mjs`](frontend/scripts/perf-lighthouse.mjs)

### 6.3 Medium Priority (Nice to Have)

4. **Lazy Asset Count is Zero**
   - **Issue:** All assets currently classified as eager
   - **Recommendation:** Review chunk splitting strategy to increase lazy chunks
   - **File:** [`frontend/artifacts/bundle-report.json`](frontend/artifacts/bundle-report.json)

5. **Duplicate Chunk Detection**
   - **Issue:** Multiple chunks with similar sizes (~391 KB) suggest potential duplication
   - **Recommendation:** Analyze chunk contents for shared dependencies
   - **Files:** `0djsjovxva91_.js`, `0ogtg~e6byxbo.js`

### 6.4 Low Priority (Future Consideration)

6. **Add Performance Budget to CI**
   - **Recommendation:** Add `bundle:budget` to `audit:prod` script
   - **Current:** `audit:prod` runs typecheck, lint, maintainability, test, build
   - **Proposed:** Add bundle budget check after build

7. **Implement Resource Hints**
   - **Recommendation:** Add `preconnect` hints for API endpoints
   - **File:** [`frontend/app/layout.tsx`](frontend/app/layout.tsx)

---

## 7. Compliance Summary

| Category | Status | Notes |
|----------|--------|-------|
| Bundle Budgets | ⚠️ | CSS violation (10% over) |
| Audio Pruning | ✅ | Excellent implementation |
| Code Splitting | ✅ | Comprehensive lazy loading |
| Build Scripts | ✅ | Well-structured tooling |
| Next.js Config | ✅ | Optimal settings |
| Security Headers | ✅ | Production-ready |
| Lighthouse | ⚠️ | Not running in CI |

---

## 8. Action Items

| Priority | Action | Owner | Due |
|----------|--------|-------|-----|
| Critical | Fix CSS budget violation | Frontend | Sprint |
| High | Enable Lighthouse in CI | DevOps | Sprint |
| High | Evaluate CDN for audio assets | Infrastructure | Backlog |
| Medium | Review chunk duplication | Frontend | Backlog |
| Low | Add bundle budget to CI | DevOps | Backlog |

---

## Appendix A: Environment Variables

```bash
# Bundle Budget Configuration
VF_FRONTEND_EAGER_JS_MAX_BYTES=409600
VF_FRONTEND_EAGER_CSS_MAX_BYTES=294912
VF_FRONTEND_EAGER_WASM_MAX_BYTES=5242880
VF_FRONTEND_BROWSER_ML_CHUNK_MAX_BYTES=921600
VF_FRONTEND_MAIN_APP_CHUNK_MAX_BYTES=230400
VF_FRONTEND_DIST_TOTAL_MAX_BYTES=62914560
VF_FRONTEND_DIST_AUDIO_MAX_BYTES=10485760

# Audio Pruning
VF_KEEP_BUNDLED_AUDIO=false

# Lighthouse
VF_ENABLE_LIGHTHOUSE=1
VF_LIGHTHOUSE_BASE_URL=http://127.0.0.1:3000
```

---

## Appendix B: File References

- Bundle Budget Script: [`frontend/scripts/bundle-budget.mjs`](frontend/scripts/bundle-budget.mjs)
- Bundle Report Script: [`frontend/scripts/bundle-report.mjs`](frontend/scripts/bundle-report.mjs)
- Audio Pruning Script: [`frontend/scripts/prune-bundled-audio.mjs`](frontend/scripts/prune-bundled-audio.mjs)
- Lighthouse Script: [`frontend/scripts/perf-lighthouse.mjs`](frontend/scripts/perf-lighthouse.mjs)
- Next.js Config: [`frontend/next.config.mjs`](frontend/next.config.mjs)
- Package Scripts: [`frontend/package.json`](frontend/package.json)
- Bundle Budget Artifact: [`frontend/artifacts/bundle-budget.json`](frontend/artifacts/bundle-budget.json)
- Bundle Report Artifact: [`frontend/artifacts/bundle-report.json`](frontend/artifacts/bundle-report.json)
- Lighthouse Summary: [`frontend/artifacts/lighthouse-summary.json`](frontend/artifacts/lighthouse-summary.json)
