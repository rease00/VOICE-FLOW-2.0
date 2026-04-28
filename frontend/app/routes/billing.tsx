import { useLocation } from "react-router";
import {
  PUBLIC_SNAPSHOT_PATHS,
  PublicSnapshotFrame,
  getPublicSnapshotSrc,
  publicRouteMeta,
} from "./_public/public-route";

export function meta() {
  return publicRouteMeta(
    "Billing | V FLOW AI",
    "Review pricing and billing information."
  );
}

export default function BillingRoute() {
  const { search } = useLocation();

  return (
    <PublicSnapshotFrame
      title="Billing | V FLOW AI"
      src={getPublicSnapshotSrc(PUBLIC_SNAPSHOT_PATHS.billing, search)}
    />
  );
}
