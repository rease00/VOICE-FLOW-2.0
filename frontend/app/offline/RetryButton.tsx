"use client";

export default function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.location.reload();
      }}
      className="glass-2 inline-flex h-10 items-center justify-center rounded-full px-5 text-sm font-medium text-[color:var(--vf-text,#1f2937)]"
    >
      Retry
    </button>
  );
}
