/**
 * Content Protection for Paid Content
 *
 * Applies copy/paste/right-click/printing protection to paid novel content.
 * Only activates on elements marked with [data-protected="true"].
 * Free content, studio UI, and public pages are NOT affected.
 */

const PROTECTED_SELECTOR = '[data-protected="true"]';
const CONTENT_PROTECTION_STYLE_SELECTOR = 'style[data-content-protection="true"]';
const CONTENT_PROTECTION_STATE_KEY = '__voiceFlowContentProtectionState__' as const;

interface ContentProtectionHandlers {
  blockCopyPaste: EventListener;
  visibilityChange: EventListener;
  keyUp: (event: KeyboardEvent) => void;
}

interface ContentProtectionState {
  activeConsumers: number;
  isActive: boolean;
  styleEl: HTMLStyleElement | null;
  devToolsOverlay: HTMLDivElement | null;
  devToolsInterval: ReturnType<typeof setInterval> | null;
  printBlurTimeout: ReturnType<typeof setTimeout> | null;
  handlers: ContentProtectionHandlers | null;
}

type WindowWithContentProtectionState = Window & {
  [CONTENT_PROTECTION_STATE_KEY]?: ContentProtectionState;
};

function getContentProtectionState(): ContentProtectionState {
  const globalWindow = window as WindowWithContentProtectionState;
  const existingState = globalWindow[CONTENT_PROTECTION_STATE_KEY];
  if (existingState) return existingState;

  const createdState: ContentProtectionState = {
    activeConsumers: 0,
    isActive: false,
    styleEl: null,
    devToolsOverlay: null,
    devToolsInterval: null,
    printBlurTimeout: null,
    handlers: null,
  };
  globalWindow[CONTENT_PROTECTION_STATE_KEY] = createdState;
  return createdState;
}

function getProtectedElements() {
  return document.querySelectorAll<HTMLElement>(PROTECTED_SELECTOR);
}

function setProtectedContentBlur(blurred: boolean) {
  getProtectedElements().forEach((el) => {
    el.style.filter = blurred ? 'blur(30px)' : '';
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

function showDevToolsWarning(state: ContentProtectionState) {
  if (!state.devToolsOverlay) {
    state.devToolsOverlay = document.createElement('div');
    state.devToolsOverlay.setAttribute('data-devtools-warning', 'true');
  }

  Object.assign(state.devToolsOverlay.style, {
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
  state.devToolsOverlay.textContent =
    'Developer tools detected. Content is protected against unauthorized access.';
  if (!state.devToolsOverlay.isConnected) {
    document.body.appendChild(state.devToolsOverlay);
  }
}

function hideDevToolsWarning(state: ContentProtectionState) {
  if (state.devToolsOverlay) {
    state.devToolsOverlay.remove();
    state.devToolsOverlay = null;
  }
}

/**
 * Apply user-select: none CSS to protected elements.
 */
function applySelectNone(state: ContentProtectionState) {
  const styleElements = Array.from(
    document.querySelectorAll<HTMLStyleElement>(CONTENT_PROTECTION_STYLE_SELECTOR),
  );
  const [existingStyle, ...duplicateStyles] = styleElements;
  duplicateStyles.forEach((el) => el.remove());

  const style = existingStyle ?? document.createElement('style');
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

  if (!style.isConnected) {
    document.head.appendChild(style);
  }

  state.styleEl = style;
  return style;
}

function clearPrintBlurTimeout(state: ContentProtectionState) {
  if (state.printBlurTimeout) {
    clearTimeout(state.printBlurTimeout);
    state.printBlurTimeout = null;
  }
}

function startDevToolsDetection(state: ContentProtectionState) {
  if (state.devToolsInterval) return;

  state.devToolsInterval = setInterval(() => {
    if (checkDevTools()) {
      showDevToolsWarning(state);
    } else {
      hideDevToolsWarning(state);
    }
  }, 2000);
}

function stopDevToolsDetection(state: ContentProtectionState) {
  if (state.devToolsInterval) {
    clearInterval(state.devToolsInterval);
    state.devToolsInterval = null;
  }
  hideDevToolsWarning(state);
}

function createHandlers(state: ContentProtectionState): ContentProtectionHandlers {
  const blockCopyPaste: EventListener = (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest(PROTECTED_SELECTOR)) {
      e.preventDefault();
    }
  };

  const visibilityChange: EventListener = () => {
    setProtectedContentBlur(document.visibilityState === 'hidden');
  };

  const keyUp = (e: KeyboardEvent) => {
    if (e.key !== 'PrintScreen') return;

    setProtectedContentBlur(true);
    clearPrintBlurTimeout(state);
    state.printBlurTimeout = setTimeout(() => {
      setProtectedContentBlur(false);
      state.printBlurTimeout = null;
    }, 1500);
  };

  return { blockCopyPaste, visibilityChange, keyUp };
}

function teardownContentProtection(state: ContentProtectionState) {
  if (state.handlers) {
    document.removeEventListener('copy', state.handlers.blockCopyPaste, true);
    document.removeEventListener('cut', state.handlers.blockCopyPaste, true);
    document.removeEventListener('contextmenu', state.handlers.blockCopyPaste, true);
    document.removeEventListener('visibilitychange', state.handlers.visibilityChange);
    document.removeEventListener('keyup', state.handlers.keyUp);
    state.handlers = null;
  }

  clearPrintBlurTimeout(state);
  stopDevToolsDetection(state);
  setProtectedContentBlur(false);

  state.styleEl?.remove();
  state.styleEl = null;
  document
    .querySelectorAll<HTMLStyleElement>(CONTENT_PROTECTION_STYLE_SELECTOR)
    .forEach((el) => el.remove());

  state.isActive = false;
}

/**
 * Activate content protection. Call once when the app mounts.
 * Returns a cleanup function.
 */
export function activateContentProtection(): () => void {
  if (typeof window === 'undefined') return () => {};

  const state = getContentProtectionState();
  state.activeConsumers += 1;

  if (!state.isActive) {
    state.handlers = state.handlers ?? createHandlers(state);

    applySelectNone(state);
    document.addEventListener('copy', state.handlers.blockCopyPaste, true);
    document.addEventListener('cut', state.handlers.blockCopyPaste, true);
    document.addEventListener('contextmenu', state.handlers.blockCopyPaste, true);
    document.addEventListener('visibilitychange', state.handlers.visibilityChange);
    document.addEventListener('keyup', state.handlers.keyUp);
    startDevToolsDetection(state);

    state.isActive = true;
  }

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;

    state.activeConsumers = Math.max(0, state.activeConsumers - 1);
    if (state.activeConsumers === 0) {
      teardownContentProtection(state);
    }
  };
}
