const DEFAULT_SUPPORT_AUTOMATION_MODEL = 'gemini-2.5-flash-lite';

export interface SupportAutomationResult {
  summary: string;
  category: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  blocked: boolean;
  needsHuman: boolean;
  suggestedMacro: string;
  queue: 'critical' | 'blocked' | 'backlog';
  priority: 'red' | 'orange' | 'yellow';
  draftReply: string;
  mode: 'rules_first';
  model: string;
  reason: string;
}

const asString = (value: unknown): string => String(value ?? '').trim();
const asLower = (value: unknown): string => asString(value).toLowerCase();

const deriveSupportCategory = (text: string): string => {
  const lower = asLower(text);
  if (/(refund|charge|charged|billing|invoice|payment|wallet|coupon|subscription)/.test(lower)) return 'billing';
  if (/(login|password|sign[ -]?in|account locked|locked out|cannot access|can.t access)/.test(lower)) return 'account';
  if (/(voice clone|clone|reference audio|separate|separation)/.test(lower)) return 'voice_clone';
  if (/(publish|chapter audio|book|reader|library)/.test(lower)) return 'publishing';
  if (/(tts|studio|generate|generation|audio novel|novel)/.test(lower)) return 'generation';
  if (/(abuse|report|copyright|dmca|illegal|fraud|spam)/.test(lower)) return 'abuse';
  if (/(feature request|idea|wish|roadmap)/.test(lower)) return 'feature_request';
  return 'general';
};

const deriveSupportUrgency = (text: string): SupportAutomationResult['urgency'] => {
  const lower = asLower(text);
  if (/(security|legal|dmca|charged twice|charged but|data loss|account locked|locked out|urgent|refund now)/.test(lower)) return 'critical';
  if (/(cannot|can't|cant|failed|broken|blocked|stuck|not working|issue)/.test(lower)) return 'high';
  if (/(slow|question|help|clarify)/.test(lower)) return 'medium';
  return 'low';
};

const buildSupportReplyDraft = (
  userName: string,
  category: string,
  needsHuman: boolean,
): string => {
  const safeUserName = asString(userName || 'there') || 'there';
  if (category === 'billing') {
    return `Hi ${safeUserName}, I have marked this for billing review so it stays in the priority queue. Please avoid retrying any paid action until we confirm the account state, and include the invoice or payment reference if you have it.`;
  }
  if (category === 'account') {
    return `Hi ${safeUserName}, this looks like an account-access issue. I have queued it for recovery review. Please keep this thread open and avoid repeated reset attempts while we verify the account state.`;
  }
  if (category === 'generation' || category === 'voice_clone') {
    return `Hi ${safeUserName}, this looks like a runtime or generation issue. I have queued it with the latest account and job context for review. Please avoid repeated retries for now so we can inspect the failing state accurately.`;
  }
  if (needsHuman) {
    return `Hi ${safeUserName}, thanks for reporting this. I have queued it for manual review with the latest account context so you do not need to resend the same details.`;
  }
  return `Hi ${safeUserName}, thanks for the details. I have recorded this in the support queue and attached the latest context so we can keep the review moving.`;
};

export const analyzeSupportRequest = (
  input: {
    text: string;
    userName?: string;
    context?: Array<string | null | undefined>;
  },
): SupportAutomationResult => {
  const joinedText = [
    ...((input.context || []).map((entry) => asString(entry)).filter(Boolean)),
    asString(input.text),
  ].join('\n');
  const category = deriveSupportCategory(joinedText);
  const urgency = deriveSupportUrgency(joinedText);
  const blocked = /(cannot|can't|cant|blocked|stuck|unable|won.t let me)/.test(asLower(joinedText));
  const needsHuman = ['billing', 'account', 'abuse'].includes(category) || urgency === 'critical';
  const suggestedMacro = category === 'billing'
    ? 'billing_triage'
    : category === 'account'
      ? 'account_recovery'
      : category === 'generation'
        ? 'generation_retry'
        : category === 'voice_clone'
          ? 'voice_clone_triage'
          : needsHuman
            ? 'manual_review'
            : 'general_ack';
  let queue: SupportAutomationResult['queue'] = 'backlog';
  if (needsHuman) {
    queue = 'critical';
  } else if (blocked) {
    queue = 'blocked';
  }
  const priority = urgency === 'critical'
    ? 'red'
    : urgency === 'high'
      ? 'orange'
      : 'yellow';

  return {
    summary: joinedText.slice(0, 240),
    category,
    urgency,
    blocked,
    needsHuman,
    suggestedMacro,
    queue,
    priority,
    draftReply: buildSupportReplyDraft(input.userName || 'there', category, needsHuman),
    mode: 'rules_first',
    model: DEFAULT_SUPPORT_AUTOMATION_MODEL,
    reason: `rules_first:${suggestedMacro}`,
  };
};
