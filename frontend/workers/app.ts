import { createRequestHandler } from "@react-router/cloudflare";
import { resolveBackendOrigin, resolveBackendTransport } from "../app/lib/backend";

type Env = {
  ASSETS?: Fetcher;
  BACKEND?: Fetcher;
  BACKEND_SERVICE?: Fetcher;
  BACKEND_ORIGIN?: string;
  API_ORIGIN?: string;
  VF_BACKEND_ORIGIN?: string;
  VF_API_ORIGIN?: string;
};

const requestHandler = createRequestHandler(
  {
    build: async () => {
      const mod = await import("virtual:react-router/server-build");
      return (mod.default ?? mod) as any;
    },
    mode: import.meta.env.MODE,
    getLoadContext({ context }) {
      const env = context.cloudflare.env as Env;
      return {
        cloudflare: context.cloudflare,
        backend: resolveBackendTransport(env),
        backendOrigin: resolveBackendOrigin(env)
      };
    }
  }
);

const STATIC_ASSET_PREFIXES = [
  "/__snapshots/",
  "/_next/",
  "/assets/",
  "/audio/",
] as const;

const STATIC_ASSET_PATHS = new Set([
  "/icon.svg",
  "/manifest.json",
  "/manifest.webmanifest",
  "/og-landing.png",
]);

function isStaticAssetPath(pathname: string): boolean {
  return STATIC_ASSET_PATHS.has(pathname) || STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-frame-options", "SAMEORIGIN");
  if (new URL(request.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function serveAsset(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) {
    return withSecurityHeaders(request, new Response("Not found", { status: 404 }));
  }

  const response = await env.ASSETS.fetch(request);
  return withSecurityHeaders(request, response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/favicon.ico") {
      return withSecurityHeaders(request, Response.redirect(`${url.origin}/icon.svg`, 302));
    }
    if (url.pathname === "/sw.js") {
      return withSecurityHeaders(
        request,
        new Response("", {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "no-store"
          }
        })
      );
    }
    if (isStaticAssetPath(url.pathname)) {
      return serveAsset(request, env);
    }

    const response = await requestHandler({
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx)
    } as any);
    return withSecurityHeaders(request, response);
  }
} satisfies ExportedHandler<Env>;
