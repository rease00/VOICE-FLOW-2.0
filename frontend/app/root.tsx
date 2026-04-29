import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  ScrollRestoration,
  Scripts,
  useRouteError
} from "react-router";

import "./global.css";

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="stylesheet" href="/_next/static/css/4e529f7ea76dcb3a.css" data-vf-source-app-styles="true" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-[color:var(--vf-bg,#020617)] text-[color:var(--vf-text,#e5eefb)] antialiased">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const title = isRouteErrorResponse(error)
    ? error.statusText || "Page unavailable"
    : "Page unavailable";
  const message = isRouteErrorResponse(error)
    ? "The requested page could not be completed. Please retry or return to the app."
    : "An unexpected runtime error occurred. Please retry or return to the app.";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{`${title} | V FLOW AI`}</title>
        <link rel="stylesheet" href="/_next/static/css/4e529f7ea76dcb3a.css" data-vf-source-app-styles="true" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-[color:var(--vf-bg,#020617)] text-[color:var(--vf-text,#e5eefb)] antialiased">
        <main className="min-h-dvh bg-slate-950 px-6 py-16 text-slate-100">
          <section className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/30">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-200">Error {status}</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
            <a
              className="mt-6 inline-flex rounded-full border border-cyan-300/40 px-5 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200"
              href="/app"
            >
              Return to app
            </a>
          </section>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
