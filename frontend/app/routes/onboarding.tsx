import { useLocation } from "react-router";
import {
  PUBLIC_SNAPSHOT_PATHS,
  PublicSnapshotFrame,
  getPublicSnapshotSrc,
  publicRouteMeta,
} from "./_public/public-route";

export function meta() {
  return publicRouteMeta(
    "V FLOW AI | AI STUDIO | V FLOW AI",
    "V FLOW AI workspace for creators and production teams."
  );
}

export default function OnboardingRoute() {
  const { search } = useLocation();

  return (
    <PublicSnapshotFrame
      title="Opening Studio"
      src={getPublicSnapshotSrc(PUBLIC_SNAPSHOT_PATHS.onboarding, search)}
    />
  );
}

