import { useEffect, useId, useRef, useState, type RefObject } from "react";

type PublicSnapshotFrameProps = {
  src: string;
  title: string;
  className?: string;
  frameRef?: RefObject<HTMLIFrameElement | null>;
};

type SnapshotFrameStatus = "loading" | "ready" | "empty" | "error";

const SNAPSHOT_MIN_HEIGHT = "100dvh";

function readFrameHref(frame: HTMLIFrameElement) {
  try {
    return frame.contentWindow?.location.href || "";
  } catch {
    return "";
  }
}

function measureSnapshotHeight(doc: Document) {
  const { body, documentElement } = doc;
  const values = [
    body?.scrollHeight,
    body?.offsetHeight,
    body?.clientHeight,
    documentElement.scrollHeight,
    documentElement.offsetHeight,
    documentElement.clientHeight,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const measured = values.length ? Math.max(...values) : 0;
  return Math.max(measured, documentElement.clientHeight || 0);
}

function snapshotHasContent(doc: Document) {
  const bodyText = doc.body?.innerText?.trim() ?? "";
  if (bodyText) {
    return true;
  }

  return Boolean(doc.body?.children.length || doc.documentElement.children.length);
}

type LegalPage = {
  slug: string;
  title: string;
  description: string;
  canonical: string;
  snapshotPath: string;
};

const LEGAL_PAGES: Record<string, LegalPage> = {
  "acceptable-use": {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    description: "Rules for safe, lawful, and responsible use of V FLOW AI.",
    canonical: "https://v-flow-ai.com/legal/acceptable-use",
    snapshotPath: "/__snapshots/legal/acceptable-use/",
  },
  "billing-refunds": {
    slug: "billing-refunds",
    title: "Billing and Refund Policy",
    description: "How billing, renewals, and refunds work for V FLOW AI plans.",
    canonical: "https://v-flow-ai.com/legal/billing-refunds",
    snapshotPath: "/__snapshots/legal/billing-refunds/",
  },
  cookies: {
    slug: "cookies",
    title: "Cookie Policy",
    description: "How cookies and similar technologies are used on V FLOW AI properties.",
    canonical: "https://v-flow-ai.com/legal/cookies",
    snapshotPath: "/__snapshots/legal/cookies/",
  },
  copyright: {
    slug: "copyright",
    title: "Copyright and IP Notice",
    description: "Copyright ownership expectations, reporting flow, and takedown process.",
    canonical: "https://v-flow-ai.com/legal/copyright",
    snapshotPath: "/__snapshots/legal/copyright/",
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    description: "How V FLOW AI collects, uses, stores, and protects personal data.",
    canonical: "https://v-flow-ai.com/legal/privacy",
    snapshotPath: "/__snapshots/legal/privacy/",
  },
  terms: {
    slug: "terms",
    title: "Terms of Service",
    description: "Rules for accessing and using V FLOW AI services, products, and websites.",
    canonical: "https://v-flow-ai.com/legal/terms",
    snapshotPath: "/__snapshots/legal/terms/",
  },
};

export const PUBLIC_SNAPSHOT_PATHS = {
  landing: "/__snapshots/landing/",
  login: "/__snapshots/app/login/",
  onboarding: "/__snapshots/app/onboarding/",
  billing: "/__snapshots/billing/",
} as const;

export function getPublicSnapshotSrc(pathname: string, search = "") {
  return `${pathname}${search}`;
}

export function getLegalPage(slug: string | undefined): LegalPage | undefined {
  const normalized = String(slug || "").trim().toLowerCase();
  return normalized ? LEGAL_PAGES[normalized] : undefined;
}

export function publicRouteMeta(title: string, description: string) {
  return [
    { title },
    { name: "description", content: description },
  ];
}

export function legalRouteMeta(slug: string | undefined) {
  const page = getLegalPage(slug);
  if (!page) {
    return [
      { title: "Not Found | V FLOW AI" },
      { name: "description", content: "Requested legal page was not found." },
    ];
  }

  return [
    { title: `${page.title} | V FLOW AI` },
    { name: "description", content: page.description },
    { name: "application-name", content: "V FLOW AI" },
    { rel: "canonical", href: page.canonical },
  ];
}

export function legalRouteLoader({ params }: { params: { slug?: string } }) {
  const page = getLegalPage(params.slug);
  if (!page) {
    throw new Response("Not Found", { status: 404 });
  }

  return page;
}

export function PublicSnapshotFrame({ src, title, className, frameRef }: PublicSnapshotFrameProps) {
  const internalFrameRef = useRef<HTMLIFrameElement | null>(null);
  const iframeRef = frameRef ?? internalFrameRef;
  const frameTitleId = useId();
  const frameStatusId = useId();
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(SNAPSHOT_MIN_HEIGHT);
  const [frameStatus, setFrameStatus] = useState<SnapshotFrameStatus>("loading");
  const [frameMessage, setFrameMessage] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let active = true;
    let didLoadSnapshot = false;
    let loadTimer: number | undefined;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let rafId = 0;

    const setSnapshotState = (status: SnapshotFrameStatus, message = "") => {
      if (!active) return;
      setFrameStatus(status);
      setFrameMessage(message);
    };

    const patchFrame = () => {
      const doc = iframe.contentDocument;
      if (!doc?.head || !doc.documentElement) {
        return false;
      }

      if (!doc.querySelector('base[data-vf-public-route-frame="top"]')) {
        doc.head.insertAdjacentHTML(
          "afterbegin",
          '<base data-vf-public-route-frame="top" target="_top" />'
        );
      }

      try {
        const childWindow = iframe.contentWindow;
        const topWindow = window.top;
        if (!childWindow || !topWindow || childWindow === topWindow) {
          return true;
        }

        const topLocation = topWindow.location;

        for (const method of ["assign", "replace"] as const) {
          try {
            Object.defineProperty(childWindow.location, method, {
              configurable: true,
              enumerable: true,
              writable: true,
              value: topLocation[method].bind(topLocation),
            });
          } catch {
            // Ignore browsers that lock down Location properties.
          }
        }
      } catch {
        // Same-origin access can still fail in locked-down environments.
      }

      return true;
    };

    const updateSize = () => {
      if (!active) return;

      const doc = iframe.contentDocument;
      if (!doc?.documentElement) {
        return;
      }

      const nextHeight = Math.max(measureSnapshotHeight(doc), window.innerHeight || 0);
      setFrameHeight(`${nextHeight}px`);

      if (snapshotHasContent(doc)) {
        setSnapshotState("ready");
      } else {
        setSnapshotState("empty", "The snapshot loaded, but there is no visible content yet.");
      }
    };

    const bindObservers = () => {
      const doc = iframe.contentDocument;
      const docEl = doc?.documentElement;
      if (!docEl) return;

      resizeObserver?.disconnect();
      mutationObserver?.disconnect();

      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(updateSize);
      });
      resizeObserver.observe(docEl);
      if (doc.body) {
        resizeObserver.observe(doc.body);
      }

      mutationObserver = new MutationObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(updateSize);
      });
      mutationObserver.observe(docEl, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });

      updateSize();
    };

    const handleLoad = () => {
      if (!patchFrame()) {
        setSnapshotState("error", "The embedded page could not be read.");
        return;
      }

      const loadedHref = readFrameHref(iframe);
      if (loadedHref === "about:blank" || !iframe.contentDocument) {
        return;
      }

      didLoadSnapshot = true;
      setFrameHeight(SNAPSHOT_MIN_HEIGHT);
      setSnapshotState("loading");
      bindObservers();
    };

    const handleError = () => {
      setSnapshotState("error", "The embedded page failed to load.");
    };

    iframe.addEventListener("load", handleLoad);
    iframe.addEventListener("error", handleError);

    window.requestAnimationFrame(() => {
      const loadedHref = readFrameHref(iframe);
      if (loadedHref !== "about:blank" && iframe.contentDocument?.readyState === "complete") {
        handleLoad();
      }
    });

    loadTimer = window.setTimeout(() => {
      if (active && !didLoadSnapshot) {
        setSnapshotState("error", "The embedded page took too long to respond.");
      }
    }, 12_000);

    return () => {
      active = false;
      if (loadTimer) {
        window.clearTimeout(loadTimer);
      }
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      iframe.removeEventListener("load", handleLoad);
      iframe.removeEventListener("error", handleError);
    };
  }, [iframeRef, retryKey, src]);

  useEffect(() => {
    if (frameStatus === "error" || frameStatus === "empty") {
      retryButtonRef.current?.focus();
    }
  }, [frameStatus]);

  const retrySnapshot = () => {
    setFrameStatus("loading");
    setFrameMessage("");
    setFrameHeight(SNAPSHOT_MIN_HEIGHT);
    setRetryKey((value) => value + 1);
  };

  return (
    <section
      className={className ?? "vf-public-snapshot-frame"}
      aria-busy={frameStatus === "loading"}
      aria-labelledby={frameTitleId}
      aria-describedby={frameStatusId}
    >
      <div className="vf-public-snapshot-frame__overlay" aria-hidden={frameStatus === "ready"}>
        <div
          className={`vf-public-snapshot-frame__status vf-public-snapshot-frame__status--${frameStatus}`}
          role={frameStatus === "error" ? "alert" : "status"}
          aria-live={frameStatus === "error" ? "assertive" : "polite"}
          id={frameStatusId}
        >
          <div className="vf-public-snapshot-frame__eyebrow">V FLOW AI snapshot</div>
          <h2 className="vf-public-snapshot-frame__title" id={frameTitleId}>
            {title}
          </h2>
          <p className="vf-public-snapshot-frame__copy">
            {frameStatus === "loading" && "Loading the embedded page and measuring its layout."}
            {frameStatus === "empty" && frameMessage}
            {frameStatus === "error" && frameMessage}
          </p>
          <div className="vf-public-snapshot-frame__actions">
            <button
              ref={retryButtonRef}
              type="button"
              className="vf-public-snapshot-frame__retry"
              onClick={retrySnapshot}
            >
              Retry snapshot
            </button>
            <a className="vf-public-snapshot-frame__open" href={src} target="_top" rel="noreferrer">
              Open directly
            </a>
          </div>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        loading="eager"
        referrerPolicy="same-origin"
        className="vf-public-snapshot-frame__iframe"
        style={{ height: frameHeight }}
        key={`${src}:${retryKey}`}
      />
    </section>
  );
}
