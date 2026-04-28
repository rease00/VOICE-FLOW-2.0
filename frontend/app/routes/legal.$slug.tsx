import { useLocation, useParams } from "react-router";
import {
  getLegalPage,
  getPublicSnapshotSrc,
  legalRouteLoader,
  legalRouteMeta,
  PublicSnapshotFrame,
} from "./_public/public-route";

export { legalRouteLoader as loader };

export function meta({ params }: { params: { slug?: string } }) {
  return legalRouteMeta(params.slug);
}

export default function LegalLeafRoute() {
  const { slug } = useParams();
  const { search } = useLocation();
  const page = getLegalPage(slug);

  if (!page) {
    return null;
  }

  return (
    <PublicSnapshotFrame
      title={page.title}
      src={getPublicSnapshotSrc(page.snapshotPath, search)}
    />
  );
}

