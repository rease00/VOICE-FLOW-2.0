import { useLocation } from "react-router";
import {
  PUBLIC_SNAPSHOT_PATHS,
  PublicSnapshotFrame,
  getPublicSnapshotSrc,
  publicRouteMeta,
} from "./_public/public-route";

export function meta() {
  return publicRouteMeta(
    "V FLOW AI \u2014 Script to voice. One workspace. No filler. | V FLOW AI",
    "Write scripts, assign AI voices across 30+ languages, direct delivery with prompts, and render final audio \u2014 all in one web workspace. Token-based billing, no monthly minimum."
  );
}

export default function LandingRoute() {
  const { search } = useLocation();

  return (
    <PublicSnapshotFrame
      title="V FLOW AI landing page"
      src={getPublicSnapshotSrc(PUBLIC_SNAPSHOT_PATHS.landing, search)}
    />
  );
}
