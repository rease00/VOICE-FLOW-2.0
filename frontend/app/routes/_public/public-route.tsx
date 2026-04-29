import { useEffect, useRef, type RefObject } from "react";

type PublicSnapshotFrameProps = {
  src: string;
  title: string;
  className?: string;
  frameRef?: RefObject<HTMLIFrameElement | null>;
};

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
  const devSnapshotOrigin = import.meta.env.DEV ? "http://127.0.0.1:3001" : "";
  return devSnapshotOrigin ? new URL(`${pathname}${search}`, devSnapshotOrigin).toString() : `${pathname}${search}`;
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

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const patchFrame = () => {
      const doc = iframe.contentDocument;
      if (doc?.head && !doc.querySelector('base[data-vf-public-route-frame="top"]')) {
        doc.head.insertAdjacentHTML(
          "afterbegin",
          '<base data-vf-public-route-frame="top" target="_top" />'
        );
      }

      try {
        const childWindow = iframe.contentWindow;
        const topWindow = window.top;
        if (!childWindow || !topWindow || childWindow === topWindow) {
          return;
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
    };

    patchFrame();
    iframe.addEventListener("load", patchFrame);
    return () => iframe.removeEventListener("load", patchFrame);
  }, [iframeRef]);

  return (
    <div className={className ?? "vf-public-snapshot-frame"}>
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        loading="eager"
        referrerPolicy="same-origin"
        className="vf-public-snapshot-frame__iframe"
      />
    </div>
  );
}
