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
    status: 'migrating',
    notes: [
      'Canonical account bootstrap, profile, entitlements, notifications, delete, reader legal-ack, and support endpoints now live in Next.js.',
      'Legacy account catchall remains for rollback and any tail paths that have not been cut over yet.',
    ],
  },
  {
    domain: 'billing',
    phase: 2,
    canonicalBase: CANONICAL_API_FAMILIES.billing,
    legacyPrefixes: ['/billing'],
    status: 'migrating',
    notes: [
      'Billing account summary, checkout, portal, subscription, token-pack, wallet conversion, and webhook routes now have native Next.js handlers.',
      'The compatibility proxy still covers remaining billing fallbacks and proxy-mode account billing rollouts.',
      'Stripe and Razorpay server clients should converge behind Next.js routes in the next migration slice.',
    ],
  },
  {
    domain: 'studio',
    phase: 3,
    canonicalBase: CANONICAL_API_FAMILIES.studio,
    legacyPrefixes: ['/ai', '/health', '/routing', '/runtime', '/tts'],
    status: 'migrating',
    notes: [
      'Canonical studio TTS, novel jobs, long-text, stream, export, and modernize paths now exist under the Cloudflare-native /api/v1/studio surface.',
      'The compatibility proxy still serves legacy ai, health, routing, runtime, and tts roots for launch overlap.',
      'Heavy media work can stay behind provider APIs or managed runtimes while product-facing routes converge in the Workers runtime.',
    ],
  },
  {
    domain: 'library',
    phase: 4,
    canonicalBase: CANONICAL_API_FAMILIES.library,
    legacyPrefixes: ['/reader', '/v1/reader'],
    status: 'migrating',
    notes: [
      'Reader object delivery and legal acknowledgement now have first-party native surfaces.',
      'The compatibility /api/v1/library proxy still requires an external backend for unmigrated reader flows.',
      'Full reader dashboard, sessions, uploads, and commercial checks still need domain-by-domain migration.',
    ],
  },
  {
    domain: 'publishing',
    phase: 4,
    canonicalBase: CANONICAL_API_FAMILIES.publishing,
    legacyPrefixes: ['/books'],
    status: 'cutover-ready',
    notes: [
      'Published book CRUD, chapter sync, and publish actions are now reachable under the native /api/v1/publishing surface.',
      'Canonical Firestore shape should converge on publishedBooks/{bookId}/chapters/{chapterId} during later migration.',
    ],
  },
  {
    domain: 'voice-clone',
    phase: 5,
    canonicalBase: CANONICAL_API_FAMILIES.voiceClone,
    legacyPrefixes: ['/voice-clone', '/voice-lab'],
    status: 'migrating',
    notes: [
      'Voice clone artifacts are now stored in the D1 voice_clone_artifacts table with full CRUD operations.',
      'Voice clone job records are persisted to D1 via the dedicated voice_clone_jobs table in addition to the domain job store.',
      'The domain job store also works with D1 via the native adapter across all domains.',
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
      'Canonical admin routes now dispatch natively inside the Workers runtime with VF_ADMIN_OPS_MODE proxy fallback.',
      'Legacy admin proxy remains available for rollback during the migration window.',
    ],
  },
  {
    domain: 'ops',
    phase: 7,
    canonicalBase: CANONICAL_API_FAMILIES.ops,
    legacyPrefixes: ['/health', `${LEGACY_PROXY_BASE}`],
    status: 'cutover-ready',
    notes: [
      'Health, contracts inventory, and guardian routes now exist as native handlers.',
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
