/**
 * Generate og-landing.png (1200×630) using Playwright.
 * Run: node scripts/generate-og-image.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgLogo = readFileSync(resolve(root, 'public/brand-logo.svg'), 'utf-8');
const b64Logo = `data:image/svg+xml;base64,${Buffer.from(svgLogo).toString('base64')}`;

const html = `<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1200px; height: 630px;
    background: #0a0a12;
    font-family: 'Inter', system-ui, sans-serif;
    color: #f0f0f8;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }
  /* aurora bg */
  .aurora {
    position: absolute; inset: 0; opacity: 0.35;
    background:
      radial-gradient(ellipse 80% 60% at 20% 30%, #6E5CFB44, transparent),
      radial-gradient(ellipse 60% 50% at 75% 60%, #A020F044, transparent),
      radial-gradient(ellipse 50% 40% at 50% 80%, #FF4AA622, transparent);
  }
  .grid-overlay {
    position: absolute; inset: 0; opacity: 0.06;
    background-image:
      linear-gradient(#fff 1px, transparent 1px),
      linear-gradient(90deg, #fff 1px, transparent 1px);
    background-size: 60px 60px;
  }
  .content {
    position: relative; z-index: 1;
    display: flex; align-items: center; gap: 56px;
    padding: 0 80px;
  }
  .logo { width: 160px; height: 160px; flex-shrink: 0; }
  .text { display: flex; flex-direction: column; gap: 16px; }
  .brand {
    font-size: 54px; font-weight: 800;
    background: linear-gradient(135deg, #f0f0f8 30%, #6E5CFB 70%, #A020F0);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    letter-spacing: -1px;
  }
  .tagline {
    font-size: 26px; font-weight: 400; color: #b0b0c8;
    letter-spacing: 0.01em;
  }
  .chips {
    display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap;
  }
  .chip {
    padding: 6px 16px; border-radius: 999px;
    background: rgba(110, 92, 251, 0.15);
    border: 1px solid rgba(110, 92, 251, 0.35);
    font-size: 15px; color: #c4bcf0; font-weight: 600;
    letter-spacing: 0.02em;
  }
  .url {
    position: absolute; bottom: 32px; right: 80px;
    font-size: 18px; color: #666680; font-weight: 600;
    letter-spacing: 0.05em;
  }
</style>
</head>
<body>
  <div class="aurora"></div>
  <div class="grid-overlay"></div>
  <div class="content">
    <img class="logo" src="${b64Logo}" alt="" />
    <div class="text">
      <div class="brand">V FLOW AI</div>
      <div class="tagline">Script to voice. One workspace. No filler.</div>
      <div class="chips">
        <span class="chip">30+ Languages</span>
        <span class="chip">Multi-Speaker Scenes</span>
        <span class="chip">AI Director</span>
        <span class="chip">Real-time Preview</span>
      </div>
    </div>
  </div>
  <div class="url">v-flow-ai.com</div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: resolve(root, 'public/og-landing.png'), type: 'png' });
await browser.close();
console.log('✓ public/og-landing.png created (1200×630)');
