import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROUTE_TIMEOUT_MS = 45_000;
const STORAGE_KEYS = {
  uiTheme: 'vf_ui_theme',
  uiBrandTheme: 'vf_ui_brand_theme',
  uiMotionLevel: 'vf_ui_motion_level',
};

const defaultBaseUrl = process.env.PLAYWRIGHT_BASE_URL || process.env.DESKTOP_AUDIT_BASE_URL || 'http://127.0.0.1:3000';
const auditDate = process.env.DESKTOP_AUDIT_DATE || new Date().toISOString().slice(0, 10);
const outputDir = path.resolve(process.cwd(), 'tmp_dir', 'playwright', `desktop-audit-${auditDate}`);

const routeReadiness = {
  '/app/studio': ['.vf-studio-grid', '.vf-editor-shell', 'button:has-text("Import")'],
  '/app/voices': ['[data-testid="voices-workspace"]', '.vf-voices-shell', 'text=Library'],
  '/app/writing': ['[data-testid="novel-workspace"]', '[data-testid="novel-editor-tabs"]', 'text=Novel Workspace'],
};

const suites = [
  {
    reportFile: 'report.json',
    theme: 'dark',
    brandTheme: 'neon',
    motion: 'off',
    viewports: [{ width: 1920, height: 1080, label: 'desktop-1920x1080' }],
    filePrefix: 'desktop',
    includeRouteLogs: true,
  },
  {
    reportFile: 'report-multi-desktop.json',
    theme: 'dark',
    brandTheme: 'neon',
    motion: 'off',
    viewports: [
      { width: 1366, height: 768, label: 'desktop-1366x768' },
      { width: 1440, height: 900, label: 'desktop-1440x900' },
      { width: 1920, height: 1080, label: 'desktop-1920x1080' },
    ],
    filePrefix: 'desktop',
    includeRouteLogs: false,
  },
  {
    reportFile: 'report-light-aurora.json',
    theme: 'light',
    brandTheme: 'aurora',
    motion: 'off',
    viewports: [{ width: 1920, height: 1080, label: 'desktop-1920x1080' }],
    filePrefix: 'desktop',
    includeRouteLogs: false,
  },
];

const routes = ['/app/studio', '/app/voices', '/app/writing'];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const requestedReports = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--report') {
      const reportName = args[index + 1];
      if (reportName) {
        requestedReports.add(reportName);
        index += 1;
      }
    }
  }

  return {
    baseUrl: defaultBaseUrl.replace(/\/+$/, ''),
    suites: requestedReports.size
      ? suites.filter((suite) => requestedReports.has(suite.reportFile))
      : suites,
  };
};

const toRouteSlug = (route) => route.replace(/^\//, '').replace(/[\\/]+/g, '-');

const waitForRouteReady = async (page, route) => {
  const selectors = routeReadiness[route] || ['body'];
  await Promise.any(
    selectors.map((selector) =>
      page.locator(selector).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS })
    )
  ).catch(() => undefined);
  await page.waitForTimeout(500);
};

const collectMetrics = async (page) =>
  page.evaluate(() => {
    const topbar = document.querySelector('.vf-topbar');
    const sidebar = document.querySelector('.vf-sidebar-shell');
    const main = document.querySelector('.vf-main-scroll');

    const topbarRect = topbar?.getBoundingClientRect() || null;
    const sidebarRect = sidebar?.getBoundingClientRect() || null;
    const mainRect = main?.getBoundingClientRect() || null;

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
      hasTopbar: Boolean(topbar),
      hasSidebar: Boolean(sidebar),
      hasMain: Boolean(main),
      topbarRect,
      sidebarRect,
      mainRect,
      topbarBottom: topbarRect?.bottom ?? null,
      mainBottom: mainRect?.bottom ?? null,
      sidebarHeight: sidebarRect?.height ?? null,
      bodyClasses: document.body.className,
      rootClasses: document.documentElement.className,
      themeMode: document.body.dataset.vfThemeMode || document.documentElement.dataset.vfThemeMode || null,
      resolvedTheme: document.body.dataset.vfResolvedTheme || document.documentElement.dataset.vfResolvedTheme || null,
      brandTheme: document.body.dataset.vfBrandTheme || document.documentElement.dataset.vfBrandTheme || null,
    };
  });

const buildScreenshotPath = ({ suite, viewport, route }) => {
  const routeSlug = toRouteSlug(route);
  const themeSuffix = suite.theme === 'light' ? `-${suite.theme}-${suite.brandTheme}` : '';
  return path.join(outputDir, `${suite.filePrefix}-${viewport.width}x${viewport.height}${themeSuffix}-${routeSlug}.png`);
};

const createContext = async (browser, suite, viewport) =>
  browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    colorScheme: suite.theme,
    reducedMotion: 'reduce',
  });

const seedPreferences = async (page, suite) => {
  await page.addInitScript(({ storageKeys, state }) => {
    localStorage.setItem(storageKeys.uiTheme, state.theme);
    localStorage.setItem(storageKeys.uiBrandTheme, state.brandTheme);
    localStorage.setItem(storageKeys.uiMotionLevel, state.motion);
  }, {
    storageKeys: STORAGE_KEYS,
    state: {
      theme: suite.theme,
      brandTheme: suite.brandTheme,
      motion: suite.motion,
    },
  });
};

const runSuite = async (browser, baseUrl, suite) => {
  const results = [];

  for (const viewport of suite.viewports) {
    for (const route of routes) {
      const context = await createContext(browser, suite, viewport);
      const page = await context.newPage();
      const routeLogs = [];

      page.on('console', (message) => {
        routeLogs.push({
          type: message.type(),
          text: message.text(),
        });
      });

      await seedPreferences(page, suite);

      const result = {
        viewport,
        route,
        url: `${baseUrl}${route}`,
        ok: false,
        screenshotPath: buildScreenshotPath({ suite, viewport, route }),
      };

      try {
        await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
        await waitForRouteReady(page, route);
        await fs.mkdir(path.dirname(result.screenshotPath), { recursive: true });
        await page.screenshot({ path: result.screenshotPath, fullPage: false });
        result.ok = true;
        result.metrics = await collectMetrics(page);
        if (suite.includeRouteLogs) {
          result.routeLogs = routeLogs;
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        result.metrics = await collectMetrics(page).catch(() => null);
      } finally {
        await context.close();
      }

      results.push(result);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    results,
  };

  if (suite.viewports.length === 1) {
    report.viewport = {
      width: suite.viewports[0].width,
      height: suite.viewports[0].height,
    };
  }

  const reportPath = path.join(outputDir, suite.reportFile);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
};

const main = async () => {
  const { baseUrl, suites: selectedSuites } = parseArgs();
  if (!selectedSuites.length) {
    throw new Error('No desktop audit suites matched the requested filters.');
  }

  const browser = await chromium.launch();

  try {
    for (const suite of selectedSuites) {
      await runSuite(browser, baseUrl, suite);
    }
  } finally {
    await browser.close();
  }
};

await main();
