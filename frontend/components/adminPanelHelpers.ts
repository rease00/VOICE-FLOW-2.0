import type { AudioMetadataRecord } from '../services/adminService';

export type AudioMetadataProvenanceEntry = {
  label: string;
  value: string;
};

const audioMetadataIntegrityFieldLabels: Array<[string, string]> = [
  ['outputSha256', 'Output SHA-256'],
  ['audibleLabelApplied', 'Audible label applied'],
  ['watermarkMode', 'Watermark mode'],
  ['watermarkId', 'Watermark ID'],
  ['watermarkVersion', 'Watermark version'],
  ['watermarkDetectable', 'Watermark detectable'],
  ['c2paStatus', 'C2PA status'],
  ['c2paManifestRef', 'C2PA manifest ref'],
  ['provenanceVersion', 'Provenance version'],
  ['provenanceError', 'Provenance error'],
];

const audioMetadataProvenanceFieldLabels: Array<[string, string]> = [
  ['provenanceSourceLabel', 'Provenance source label'],
  ['provenanceId', 'Provenance ID'],
  ['provenanceRequestId', 'Provenance request ID'],
  ['provenanceJobId', 'Provenance job ID'],
  ['provenanceTraceId', 'Provenance trace ID'],
  ['provenanceEngine', 'Provenance engine'],
  ['provenanceVoiceId', 'Provenance voice ID'],
  ['provenanceVoiceName', 'Provenance voice name'],
];

const humanizeAudioMetadataKey = (key: string): string =>
  key
    .replace(/^provenance/i, 'Provenance ')
    .replace(/^source/i, 'Source ')
    .replace(/^origin/i, 'Origin ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

export const isRbacGuardError = (error: unknown): boolean => {
  const message = String((error as { message?: string; detail?: unknown })?.message || (error as { detail?: unknown })?.detail || '')
    .trim()
    .toLowerCase();
  if (!message) return false;
  return (
    message.includes('rbac_')
    || message.includes('super_admin')
    || message.includes('self-demote')
    || message.includes('self-disable')
    || message.includes('last active super admin')
    || message.includes('target_super_admin')
  );
};

export const getAudioMetadataProvenanceEntries = (
  record: AudioMetadataRecord | null | undefined
): AudioMetadataProvenanceEntry[] => {
  if (!record) return [];
  const topLevel = record as unknown as Record<string, unknown>;
  const nestedProvenance =
    topLevel.provenance && typeof topLevel.provenance === 'object' && !Array.isArray(topLevel.provenance)
      ? (topLevel.provenance as unknown as Record<string, unknown>)
      : null;
  const entries: AudioMetadataProvenanceEntry[] = [];
  const seen = new Set<string>();

  const addEntry = (label: string, rawValue: unknown): void => {
    const value = String(rawValue ?? '').trim();
    if (!value || seen.has(label)) return;
    seen.add(label);
    entries.push({ label, value });
  };

  for (const [key, label] of audioMetadataIntegrityFieldLabels) {
    const rawValue = topLevel[key];
    if (typeof rawValue === 'boolean') {
      addEntry(label, rawValue ? 'yes' : 'no');
    } else {
      addEntry(label, rawValue);
    }
  }

  for (const [key, label] of audioMetadataProvenanceFieldLabels) {
    addEntry(label, topLevel[key]);
    if (nestedProvenance) {
      const nestedKey = key.replace(/^provenance/i, '');
      const normalizedNestedKey = nestedKey.charAt(0).toLowerCase() + nestedKey.slice(1);
      addEntry(label, nestedProvenance[key] ?? nestedProvenance[nestedKey] ?? nestedProvenance[normalizedNestedKey]);
    }
  }

  if (nestedProvenance) {
    for (const [key, value] of Object.entries(nestedProvenance)) {
      addEntry(`Provenance ${humanizeAudioMetadataKey(key)}`, value);
    }
  }

  for (const [key, value] of Object.entries(topLevel)) {
    if (!/^provenance/i.test(key)) continue;
    addEntry(humanizeAudioMetadataKey(key), value);
  }

  return entries;
};

export const renderBooleanLabel = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') return 'yes';
    if (normalized === 'false' || normalized === 'no' || normalized === '0') return 'no';
  }
  return String(value ?? '').trim();
};
