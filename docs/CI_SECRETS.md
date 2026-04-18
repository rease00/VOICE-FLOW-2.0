# CI/CD Secrets — `feat/relaunch-aurora`

This document is the single source of truth for every secret and repository variable that the GitHub Actions workflows in this repo expect. If a secret here is missing, the corresponding deploy will fail closed (no traffic shifted, no destructive changes).

> **Convention:** repo-scoped secrets live under `Settings → Secrets and variables → Actions → Secrets`. Non-sensitive identifiers (project IDs, bucket names, region) live under **Variables** so they show in logs and PRs.

## How to validate locally

```pwsh
# Loads .env.local + frontend/.env.local, probes Cloudflare/Stripe APIs.
node scripts/secrets-doctor.mjs
```

## Frontend → Cloudflare Workers (`deploy-frontend.yml`)

| Name | Type | Purpose | How to get |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secret | Wrangler deploy + R2 | Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | var | Wrangler scope | Cloudflare dashboard sidebar |
| `CLOUDFLARE_ZONE_ID` | var | DNS / cache purge | Domain overview page |

## Backend → Cloud Run (`deploy-backend.yml`)

Authentication is **OIDC via Workload Identity Federation** — no JSON key stored in GitHub.

| Name | Type | Purpose |
| --- | --- | --- |
| `GCP_PROJECT_ID` | var | `v-flow-ai-491311` |
| `GCP_REGION` | var | `us-central1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | secret | `projects/<num>/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | secret | `github-deployer@v-flow-ai-491311.iam.gserviceaccount.com` |
| `ARTIFACT_REGISTRY_REPO` | var | `voiceflow` |

### One-time WIF bootstrap

```bash
PROJECT=v-flow-ai-491311
gcloud iam service-accounts create github-deployer --project $PROJECT
gcloud iam workload-identity-pools create github --project $PROJECT --location global
gcloud iam workload-identity-pools providers create-oidc github \
  --workload-identity-pool=github --location=global --project=$PROJECT \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"
# Bind repo
gcloud iam service-accounts add-iam-policy-binding \
  github-deployer@$PROJECT.iam.gserviceaccount.com --project $PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<NUM>/locations/global/workloadIdentityPools/github/attribute.repository/<owner>/<repo>"
# Grant deploy roles
for ROLE in run.admin artifactregistry.writer iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:github-deployer@$PROJECT.iam.gserviceaccount.com" \
    --role="roles/$ROLE"
done
```

## Storage — R2 lifecycle (`scripts/r2-lifecycle-apply.mjs`)

| Name | Type | Purpose |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | var | Same as `CLOUDFLARE_ACCOUNT_ID` |
| `R2_ACCESS_KEY_ID` | secret | R2 → Manage R2 API Tokens |
| `R2_SECRET_ACCESS_KEY` | secret | (shown once on creation) |
| `R2_BUCKET` | var | default: `vf-assets` |

## Backups (`backup-firestore.yml`)

Reuses the WIF identity above. Add this role:

```bash
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:github-deployer@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/datastore.importExportAdmin"
```

| Name | Type | Purpose |
| --- | --- | --- |
| `FIRESTORE_BACKUP_BUCKET` | var | `gs://v-flow-ai-491311-firestore-backups` (auto-created on first run) |
| `MIRROR_TO_R2` | var | `"true"` to copy nightly export to R2 (uses R2_* secrets above) |

## Stripe (subscription gating, paid-only features)

| Name | Type | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | secret | server-side checkout / portal |
| `STRIPE_WEBHOOK_SECRET` | secret | `whsec_...` for `/api/v1/billing/webhook` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | var | injected at build time |

## Firebase (server-side admin)

| Name | Type | Purpose |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | secret | base64 or raw JSON; used by `firebase-admin` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | var | `v-flow-ai-491311` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | var | client SDK |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | var | `v-flow-ai-491311.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | var | client SDK |

## Runtime auth

| Name | Type | Purpose |
| --- | --- | --- |
| `GEMINI_RUNTIME_ADMIN_TOKEN` | secret | shared bearer between API and gemini-runtime |
| `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` | secret | Voice-clone runtime calls |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | secret | replaces Memorystore (zero-cost-at-idle) |

## Optional — preview Lighthouse (`preview-lighthouse.yml`)

No additional secrets; uses `secrets.GITHUB_TOKEN` for PR comments.

---

**Deletion policy:** never delete a secret without first rotating it in the upstream provider. Every secret listed here has a rotation runbook in [docs/RELIABILITY_RUNBOOK.md](../docs/RELIABILITY_RUNBOOK.md).
