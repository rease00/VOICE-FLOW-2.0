import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import {
  PUBLIC_SNAPSHOT_PATHS,
  PublicSnapshotFrame,
  getPublicSnapshotSrc,
  publicRouteMeta,
} from "./_public/public-route";
import { sanitizeLoginNext } from "./_shared";

export function meta() {
  return publicRouteMeta(
    "Login | V FLOW AI",
    "Sign in to continue to your workspace."
  );
}

export default function LoginRoute() {
  const { search } = useLocation();
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const expectedOrigin = (() => {
      try {
        return new URL(getPublicSnapshotSrc(PUBLIC_SNAPSHOT_PATHS.login, search), window.location.href).origin;
      } catch {
        return window.location.origin;
      }
    })();

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) {
        return;
      }

      if (event.source !== frameRef.current?.contentWindow) {
        return;
      }

      const payload =
        typeof event.data === "string"
          ? { type: event.data, nextPath: null }
          : (event.data as { type?: unknown; nextPath?: unknown } | null);
      if (!payload || payload.type !== "vf-login-success") {
        return;
      }

      const nextPath = sanitizeLoginNext(
        typeof payload.nextPath === "string"
          ? payload.nextPath
          : new URLSearchParams(search).get('next')
      );

      window.location.replace(new URL(nextPath, window.location.origin).toString());
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [search]);

  return (
    <PublicSnapshotFrame
      title="Login | V FLOW AI"
      src={getPublicSnapshotSrc(PUBLIC_SNAPSHOT_PATHS.login, search)}
      frameRef={frameRef}
    />
  );
}
