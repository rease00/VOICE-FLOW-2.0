/**
 * Content Protection for Paid Content
 *
 * Applies copy/paste/right-click/printing protection to paid novel content.
 * Only activates on elements marked with [data-protected="true"].
 * Free content, studio UI, and public pages are NOT affected.
 */

const PROTECTED_SELECTOR = '[data-protected="true"]';

/**
 * Prevent copy, cut, and context menu on protected content.
 */
function blockCopyPaste(e: Event) {
  const target = e.target as HTMLElement | null;
  if (target?.closest(PROTECTED_SELECTOR)) {
    e.preventDefault();
  }
}

/**
 * Blur protected content when tab loses focus.
 */
function handleVisibilityChange() {
  const els = document.querySelectorAll<HTMLElement>(PROTECTED_SELECTOR);
  const hidden = document.visibilityState === 'hidden';
  els.forEach((el) => {
    el.style.filter = hidden ? 'blur(30px)' : '';
    el.style.transition = 'filter 0.2s ease';
  });
}

/**
 * Detect DevTools by comparing window dimensions (heuristic).
 */
function checkDevTools(): boolean {
  const threshold = 100;
  return (
    window.outerWidth - window.innerWidth > threshold ||
    window.outerHeight - window.innerHeight > threshold
  );
}

let devToolsOverlay: HTMLDivElement | null = null;

function showDevToolsWarning() {
  if (devToolsOverlay) return;
  devToolsOverlay = document.createElement('div');
  devToolsOverlay.setAttribute('data-devtools-warning', 'true');
  Object.assign(devToolsOverlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.85)',
    color: '#f87171',
    fontSize: '18px',
    fontWeight: '600',
    textAlign: 'center',
    padding: '2rem',
  } satisfies Partial<Record<string, string>>);
  devToolsOverlay.textContent =
    'Developer tools detected. Content is protected against unauthorized access.';
  document.body.appendChild(devToolsOverlay);
}

function hideDevToolsWarning() {
  if (devToolsOverlay) {
    devToolsOverlay.remove();
    devToolsOverlay = null;
  }
}

let devToolsInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Apply user-select: none CSS to protected elements.
 */
function applySelectNone() {
  const style = document.createElement('style');
  style.setAttribute('data-content-protection', 'true');
  style.textContent = `
    ${PROTECTED_SELECTOR} {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    @media print {
      ${PROTECTED_SELECTOR} {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);
  return style;
}

let cleanupFns: (() => void)[] = [];

/**
 * Activate content protection. Call once when the app mounts.
 * Returns a cleanup function.
 */
export function activateContentProtection(): () => void {
  if (typeof window === 'undefined') return () => {};

  // CSS
  const styleEl = applySelectNone();

  // Event listeners
  document.addEventListener('copy', blockCopyPaste, true);
  document.addEventListener('cut', blockCopyPaste, true);
  document.addEventListener('contextmenu', blockCopyPaste, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // DevTools detection
  devToolsInterval = setInterval(() => {
    if (checkDevTools()) {
      showDevToolsWarning();
    } else {
      hideDevToolsWarning();
    }
  }, 2000);

  // PrintScreen detection
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'PrintScreen') {
      const els = document.querySelectorAll<HTMLElement>(PROTECTED_SELECTOR);
      els.forEach((el) => {
        el.style.filter = 'blur(30px)';
      });
      setTimeout(() => {
        els.forEach((el) => {
          el.style.filter = '';
        });
      }, 1500);
    }
  };
  document.addEventListener('keyup', handleKeyDown);

  const cleanup = () => {
    styleEl.remove();
    document.removeEventListener('copy', blockCopyPaste, true);
    document.removeEventListener('cut', blockCopyPaste, true);
    document.removeEventListener('contextmenu', blockCopyPaste, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('keyup', handleKeyDown);
    if (devToolsInterval) clearInterval(devToolsInterval);
    hideDevToolsWarning();
  };

  return cleanup;
}
