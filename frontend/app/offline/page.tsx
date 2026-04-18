import type { Metadata } from "next";
import Link from "next/link";
import RetryButton from "./RetryButton";

export const metadata: Metadata = {
  title: "Offline",
  description: "You appear to be offline. Cached content remains available.",
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div
        aria-hidden
        className="aurora-bg flex h-16 w-16 items-center justify-center rounded-full text-white shadow-[0_8px_24px_rgba(124,92,255,0.45)]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </svg>
      </div>
      <h1 className="aurora-text text-3xl font-semibold tracking-[var(--tracking-tight)]">
        You&rsquo;re offline
      </h1>
      <p className="text-[color:var(--vf-text-muted,#5f6f84)]">
        We&rsquo;ll reconnect automatically when your network returns. Anything
        you&rsquo;ve already opened stays cached and playable.
      </p>
      <div className="flex gap-3">
        <Link
          href="/app/reader"
          className="inline-flex h-10 items-center justify-center rounded-full bg-[color:var(--vf-text,#1f2937)] px-5 text-sm font-medium text-[color:var(--vf-bg,#fff)]"
        >
          Open cached library
        </Link>
        <RetryButton />
      </div>
    </main>
  );
}
