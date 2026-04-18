import { CANONICAL_API_FAMILIES, getReplatformRuntimeSummary, LEGACY_PROXY_BASE } from './runtime';

export interface ReplatformContractDomain {
  domain: string;
  phase: number;
  canonicalBase: string;
  legacyPrefixes: string[];
  status: 'planned' | 'scaffolded' | 'migrating' | 'cutover-ready';
  notes: string[];
}

export const REPLATFORM_CONTRACT_DOMAINS: ReplatformContractDomain[] = [
  {
    domain: 'account',
    phase: 2,
    canonicalBase: CANONICAL_API_FAMILIES.account,
    legacyPrefixes: ['/account', '/auth', '/kyc', '/withdrawal'],
    status: 'scaffolded',
    notes: [
      'Canonical account bootstrap, KYC, withdrawal, and reader legal-ack endpoints now live in Next.js.',
      'Legacy account proxy remains available for unmigrated notifications, profile, and entitlements flows.',
    ],
  },
  {
    domain: 'billing',
    phase: 2,
    canonicalBase: CANONICAL_API_FAMILIES.billing,
    legacyPrefixes: ['/billing'],
    status: 'planned',
    notes: [
      'Billing still primarily resolves through the compatibility proxy.',
      'Cloudflare-only launch stays blocked until billing routes are migrated or VF_MEDIA_BACKEND_URL points at a real compatibility backend.',
      'Stripe and Razorpay server clients should converge behind Next.js routes in the next migration slice.',
    ],
  },
  {
    domain: 'studio',
    phase: 3,
    canonicalBase: CANONICAL_API_FAMILIES.studio,
    legacyPrefixes: ['/tts', '/v1/tts', '/translate'],
    status: 'migrating',
    notes: [
      'Canonical studio TTS, novel jobs, long-text, stream, export, and modernize paths now exist under /api/v1/studio.',
      'The legacy /api/v1/tts compatibility surface still requires an external backend for launch.',
      'Heavy media work can stay behind provider APIs or managed runtimes while product-facing routes converge in Next.js.',
    ],
  },
  {
    domain: 'library',
    phase: 4,
    canonicalBase: CANONICAL_API_FAMILIES.library,
    legacyPrefixes: ['/reader', '/v1/reader'],
    status: 'migrating',
    notes: [
      'Reader object delivery and legal acknowledgement now have first-party Next.js surfaces.',
      'The compatibility /api/v1/library proxy still requires an external backend for unmigrated reader flows.',
      'Full reader dashboard, sessions, uploads, and commercial checks still need domain-by-domain migration.',
    ],
  },
  {
    domain: 'publishing',
    phase: 4,
    canonicalBase: CANONICAL_API_FAMILIES.publishing,
    legacyPrefixes: ['/books'],
    status: 'migrating',
    notes: [
      'Published book CRUD, chapter sync, and publish actions are now reachable under /api/v1/publishing.',
      'Canonical Firestore shape should converge on publishedBooks/{bookId}/chapters/{chapterId} during later migration.',
    ],
  },
  {
    domain: 'voice-clone',
    phase: 5,
    canonicalBase: CANONICAL_API_FAMILIES.voiceClone,
    legacyPrefixes: ['/voice-clone', '/voice-lab'],
    status: 'planned',
    notes: [
      'Voice clone and heavy media orchestration are intentionally deferred behind managed runtimes until the control plane is ready.',
      'Proxy mode is launch-safe only when VF_MEDIA_BACKEND_URL is configured to a real compatibility backend.',
    ],
  },
  {
    domain: 'admin',
    phase: 7,
    canonicalBase: CANONICAL_API_FAMILIES.admin,
    legacyPrefixes: ['/admin', '/runtime', '/routing'],
    status: 'migrating',
    notes: [
      'Canonical admin routes now dispatch natively inside Next.js with VF_ADMIN_OPS_MODE proxy fallback.',
      'Legacy admin proxy remains available for rollback during the migration window.',
    ],
  },
  {
    domain: 'ops',
    phase: 7,
    canonicalBase: CANONICAL_API_FAMILIES.ops,
    legacyPrefixes: ['/health', `${LEGACY_PROXY_BASE}`],
    status: 'migrating',
    notes: [
      'Health, contracts inventory, and guardian routes now exist as native Next.js handlers.',
      'Legacy ops proxy remains available only as rollback compatibility during the migration window.',
    ],
  },
];

export const getReplatformContractInventory = () => {
  return {
    generatedAt: new Date().toISOString(),
    runtime: getReplatformRuntimeSummary(),
    domains: REPLATFORM_CONTRACT_DOMAINS,
  };
};
