export type LegalDocumentId =
  | 'terms'
  | 'privacy'
  | 'acceptable-use'
  | 'cookies'
  | 'billing-refunds'
  | 'copyright';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  path: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: LegalSection[];
}

export interface LegalLink {
  path: string;
  label: string;
}

export const LEGAL_LINKS: LegalLink[] = [
  { path: '/legal/terms', label: 'Terms' },
  { path: '/legal/privacy', label: 'Privacy' },
  { path: '/legal/acceptable-use', label: 'Acceptable Use' },
  { path: '/legal/cookies', label: 'Cookies' },
  { path: '/legal/billing-refunds', label: 'Billing & Refunds' },
  { path: '/legal/copyright', label: 'Copyright' },
];

const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    id: 'terms',
    path: '/legal/terms',
    title: 'Terms of Service',
    description:
      'Rules for accessing and using VoiceFlow services, products, and websites.',
    lastUpdated: 'March 14, 2026',
    sections: [
      {
        heading: '1. Agreement and scope',
        paragraphs: [
          'By using VoiceFlow, you agree to these Terms. If you do not agree, do not use the service.',
          'These Terms apply to the VoiceFlow website, app, APIs, and related services provided under the VoiceFlow brand.',
        ],
      },
      {
        heading: '2. Eligibility',
        paragraphs: [
          'VoiceFlow is intended for users aged 13 and above.',
          'If you are under 18, you confirm that a parent or legal guardian has reviewed and consented to your use of the service.',
        ],
      },
      {
        heading: '3. Accounts and security',
        paragraphs: [
          'You are responsible for account credentials, device security, and activities under your account.',
          'You must provide accurate registration information and keep it reasonably up to date.',
        ],
      },
      {
        heading: '4. Acceptable use',
        paragraphs: [
          'You may not use VoiceFlow for unlawful, infringing, deceptive, abusive, or harmful activity.',
          'You may not attempt to bypass limits, extract other users’ data, reverse engineer protected systems, or disrupt platform availability.',
        ],
      },
      {
        heading: '5. AI and service outputs',
        paragraphs: [
          'VoiceFlow uses a mix of in-house and third-party AI technologies. Provider stack, models, and implementation details may change at any time to improve quality, reliability, or compliance.',
          'Outputs are probabilistic and may contain errors. You are responsible for review, editorial decisions, and legal compliance before publishing or distributing generated content.',
        ],
      },
      {
        heading: '6. Intellectual property',
        paragraphs: [
          'VoiceFlow and related branding, software, and product design remain property of the platform operator and licensors.',
          'You must only upload or generate content you have the rights or permissions to use.',
        ],
      },
      {
        heading: '7. Suspension and termination',
        paragraphs: [
          'VoiceFlow may suspend or terminate access for Terms violations, abuse, legal requests, fraud risk, or platform security concerns.',
          'You may stop using the service at any time.',
        ],
      },
      {
        heading: '8. Disclaimer and liability limits',
        paragraphs: [
          'VoiceFlow is provided on an “as available” basis without warranties of uninterrupted operation or specific commercial outcomes.',
          'To the maximum extent allowed by law, VoiceFlow is not liable for indirect, consequential, special, or punitive damages.',
        ],
      },
      {
        heading: '9. Governing framework and contact',
        paragraphs: [
          'These Terms are designed with India-first legal framing and global user protections in mind, including rights-style disclosures for international users.',
          'For legal notices or questions, contact legal@v-flow-ai.com.',
        ],
      },
    ],
  },
  {
    id: 'privacy',
    path: '/legal/privacy',
    title: 'Privacy Policy',
    description:
      'How VoiceFlow collects, uses, stores, and protects personal data.',
    lastUpdated: 'March 14, 2026',
    sections: [
      {
        heading: '1. What we collect',
        paragraphs: [
          'We may collect account identifiers (such as email and user ID), authentication state, subscription and entitlement records, product usage metrics, support communications, and user-provided content required to operate features.',
          'Technical data may include IP-derived region, browser/device signals, request logs, and security diagnostics.',
        ],
      },
      {
        heading: '2. Why we process data',
        paragraphs: [
          'We process data to provide, secure, maintain, and improve VoiceFlow features.',
          'We also process data for abuse prevention, reliability monitoring, billing operations, and legal compliance.',
        ],
      },
      {
        heading: '3. AI processing and providers',
        paragraphs: [
          'Some processing may be handled by in-house systems and some by third-party service providers, including AI infrastructure providers.',
          'Provider details can change over time as part of product operations and reliability management.',
        ],
      },
      {
        heading: '4. Retention',
        paragraphs: [
          'We retain personal data only as long as needed for service delivery, legal obligations, dispute handling, and legitimate business or security purposes.',
          'Retention periods can vary by data category and legal requirement.',
        ],
      },
      {
        heading: '5. Data sharing',
        paragraphs: [
          'We do not sell personal data as a data broker.',
          'We may share data with trusted processors and infrastructure providers under contractual controls, or when required by law.',
        ],
      },
      {
        heading: '6. User rights',
        paragraphs: [
          'Depending on your region, you may request access, correction, deletion, portability, and restriction/objection rights where applicable.',
          'You can submit requests through support@v-flow-ai.com or legal@v-flow-ai.com. We may need to verify identity before fulfilling requests.',
        ],
      },
      {
        heading: '7. Cross-border handling',
        paragraphs: [
          'VoiceFlow may process data in multiple jurisdictions through secure infrastructure and approved providers.',
          'Where required, we use contractual and operational safeguards for lawful cross-border processing.',
        ],
      },
      {
        heading: '8. Security',
        paragraphs: [
          'We use reasonable technical and organizational safeguards, including access controls, monitoring, and encryption in transit where applicable.',
          'No internet service can guarantee absolute security.',
        ],
      },
      {
        heading: '9. Children and minors',
        paragraphs: [
          'VoiceFlow is not intended for children under 13.',
          'For users under 18, guardian consent is required.',
        ],
      },
      {
        heading: '10. Contact',
        paragraphs: [
          'For privacy requests: support@v-flow-ai.com',
          'For legal/privacy escalation: legal@v-flow-ai.com',
        ],
      },
    ],
  },
  {
    id: 'acceptable-use',
    path: '/legal/acceptable-use',
    title: 'Acceptable Use Policy',
    description:
      'Rules for safe, lawful, and responsible use of VoiceFlow.',
    lastUpdated: 'March 14, 2026',
    sections: [
      {
        heading: '1. Prohibited content and behavior',
        paragraphs: [
          'Do not use VoiceFlow for unlawful conduct, harassment, hate speech, explicit non-consensual content, fraud, impersonation, or deceptive manipulation.',
          'Do not upload or generate content that infringes intellectual property or violates privacy/personality rights.',
        ],
      },
      {
        heading: '2. Platform abuse',
        paragraphs: [
          'Do not attempt unauthorized access, scraping of restricted data, credential attacks, reverse engineering of protected systems, or denial-of-service behavior.',
          'Do not bypass quotas, controls, or account limitations.',
        ],
      },
      {
        heading: '3. High-risk use restrictions',
        paragraphs: [
          'VoiceFlow is not intended as a sole decision system for legal, medical, emergency, or life-critical outcomes.',
          'You must include appropriate human review and safeguards for any high-impact workflow.',
        ],
      },
      {
        heading: '4. Enforcement',
        paragraphs: [
          'Violations may result in content removal, temporary suspension, permanent termination, or legal escalation.',
          'VoiceFlow may investigate suspected abuse and cooperate with lawful requests from competent authorities.',
        ],
      },
    ],
  },
  {
    id: 'cookies',
    path: '/legal/cookies',
    title: 'Cookie Policy',
    description:
      'How cookies and similar technologies are used on VoiceFlow properties.',
    lastUpdated: 'March 14, 2026',
    sections: [
      {
        heading: '1. Categories of cookies',
        paragraphs: [
          'Essential cookies: required for authentication, security, and core session continuity.',
          'Functional cookies: remember preferences such as UI state and selected options.',
          'Performance/analytics cookies: help understand reliability and product usage trends.',
        ],
      },
      {
        heading: '2. Why we use cookies',
        paragraphs: [
          'Cookies help us provide secure sign-in, maintain session state, improve performance, and reduce repeated friction for users.',
          'Some storage is also used for local client settings and product continuity features.',
        ],
      },
      {
        heading: '3. Controls',
        paragraphs: [
          'You can manage cookies in browser settings, but disabling essential cookies may break core app functionality.',
          'Where consent controls are required by local law, we will apply those controls for affected regions.',
        ],
      },
      {
        heading: '4. Contact',
        paragraphs: [
          'For cookie and tracking questions, contact support@v-flow-ai.com.',
        ],
      },
    ],
  },
  {
    id: 'billing-refunds',
    path: '/legal/billing-refunds',
    title: 'Billing and Refund Policy',
    description:
      'Current free access terms and paid-plan policy framework for future rollout.',
    lastUpdated: 'March 14, 2026',
    sections: [
      {
        heading: '1. Current product state',
        paragraphs: [
          'VoiceFlow currently supports free access tiers with platform limits.',
          'Paid plans, token packs, or subscriptions may be introduced or changed later with notice in product interfaces or policy updates.',
        ],
      },
      {
        heading: '2. Pricing and taxes',
        paragraphs: [
          'Any paid pricing, billing cadence, and taxes/fees will be shown at checkout before charge authorization.',
          'You are responsible for ensuring your payment details remain valid and accurate.',
        ],
      },
      {
        heading: '3. Renewals and cancellation',
        paragraphs: [
          'If subscriptions are enabled, recurring plans renew automatically unless canceled before the next billing cycle.',
          'Cancellation stops future renewals but does not retroactively reverse prior usage.',
        ],
      },
      {
        heading: '4. Refund baseline',
        paragraphs: [
          'Except where required by law, completed billing periods, consumed usage credits, and delivered digital services are generally non-refundable.',
          'Refund exceptions may be made for duplicate billing, technical charging errors, or legally mandated rights.',
        ],
      },
      {
        heading: '5. Support',
        paragraphs: [
          'For billing help and dispute intake: support@v-flow-ai.com.',
          'For legal billing escalations: legal@v-flow-ai.com.',
        ],
      },
    ],
  },
  {
    id: 'copyright',
    path: '/legal/copyright',
    title: 'Copyright and IP Notice',
    description:
      'Copyright ownership expectations, reporting flow, and takedown process.',
    lastUpdated: 'March 14, 2026',
    sections: [
      {
        heading: '1. Ownership',
        paragraphs: [
          'You retain rights to content you lawfully own and submit, subject to rights needed for service operation.',
          'VoiceFlow branding, software, and platform materials remain protected intellectual property of the platform operator and licensors.',
        ],
      },
      {
        heading: '2. User responsibility',
        paragraphs: [
          'You must only upload, synthesize, or distribute content where you have rights, licenses, or legal permission.',
          'You are responsible for obtaining required permissions for voice likeness, scripts, media assets, and distribution.',
        ],
      },
      {
        heading: '3. Takedown requests',
        paragraphs: [
          'If you believe your copyright or related rights are being infringed, send a notice to legal@v-flow-ai.com with sufficient identifying details, ownership basis, and requested action.',
          'Good-faith misuse or fraudulent notices may lead to enforcement action under applicable law.',
        ],
      },
      {
        heading: '4. Repeat infringement policy',
        paragraphs: [
          'VoiceFlow may remove content and suspend or terminate repeat infringers.',
          'We may preserve relevant evidence and cooperate with lawful legal requests.',
        ],
      },
    ],
  },
];

const normalizePath = (pathname: string): string => {
  const raw = String(pathname || '/').trim();
  if (!raw) return '/';
  const sanitized = raw.startsWith('/') ? raw : `/${raw}`;
  if (sanitized !== '/' && sanitized.endsWith('/')) {
    return sanitized.slice(0, -1);
  }
  return sanitized;
};

export const resolveLegalDocument = (pathname: string): LegalDocument | null => {
  const safePath = normalizePath(pathname);
  return LEGAL_DOCUMENTS.find((document) => document.path === safePath) || null;
};

export const isLegalPath = (pathname: string): boolean => {
  const safePath = normalizePath(pathname);
  return safePath === '/legal' || safePath.startsWith('/legal/');
};

export const getLegalDocuments = (): LegalDocument[] => LEGAL_DOCUMENTS.slice();
