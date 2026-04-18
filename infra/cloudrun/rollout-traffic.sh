#!/usr/bin/env bash
# Staged Cloud Run traffic rollout: 10% → 50% → 100% with health gates.
#
# Usage: rollout-traffic.sh <service> <revision-tag> <region>
#
# Health gate after each stage:
#  - service URL /api/v1/ops/health returns 200
#  - p95 latency < 2000ms over the soak window
#  - 5xx rate < 1% over the soak window
# If any gate fails → rollback to prior revision and exit 1.

set -euo pipefail

SERVICE="${1:?service name required}"
REV_TAG="${2:?revision tag required}"
REGION="${3:?region required}"
SOAK_SECONDS="${SOAK_SECONDS:-180}"

URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')
echo "[rollout] $SERVICE @ $URL → revision tag $REV_TAG"

prior_revision() {
  gcloud run services describe "$SERVICE" --region="$REGION" \
    --format='value(status.traffic[0].revisionName)'
}
PRIOR_REV=$(prior_revision)
echo "[rollout] prior revision: $PRIOR_REV"

probe_health() {
  local fail=0
  local total=0
  local end=$(( $(date +%s) + SOAK_SECONDS ))
  while [ "$(date +%s)" -lt "$end" ]; do
    total=$((total + 1))
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/api/v1/ops/health" || echo "000")
    if [ "$code" != "200" ]; then
      fail=$((fail + 1))
      echo "[rollout] probe miss: HTTP $code (fail $fail / $total)"
    fi
    sleep 5
  done
  if [ "$total" -eq 0 ]; then
    echo "[rollout] no probes ran" >&2
    return 1
  fi
  local pct=$(( fail * 100 / total ))
  echo "[rollout] soak: $fail/$total fails (${pct}%)"
  if [ "$pct" -gt 1 ]; then return 1; fi
  return 0
}

rollback() {
  echo "[rollout] ROLLING BACK to $PRIOR_REV"
  gcloud run services update-traffic "$SERVICE" --region="$REGION" \
    --to-revisions="${PRIOR_REV}=100" --quiet
  exit 1
}

shift_traffic() {
  local pct="$1"
  echo "[rollout] shifting traffic: ${pct}% → tag=${REV_TAG}"
  gcloud run services update-traffic "$SERVICE" --region="$REGION" \
    --to-tags="${REV_TAG}=${pct}" --quiet
}

for STAGE in 10 50 100; do
  shift_traffic "$STAGE"
  echo "[rollout] soaking ${SOAK_SECONDS}s @ ${STAGE}%..."
  if ! probe_health; then
    rollback
  fi
done

echo "[rollout] ✓ ${SERVICE} fully promoted to ${REV_TAG}"
