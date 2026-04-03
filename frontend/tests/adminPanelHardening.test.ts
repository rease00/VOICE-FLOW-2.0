import { describe, expect, it } from 'vitest';

import {
  getAudioMetadataProvenanceEntries,
  isRbacGuardError,
  renderBooleanLabel,
} from '../components/adminPanelHelpers';

describe('admin panel hardening helpers', () => {
  it('detects server RBAC guard rejections', () => {
    expect(isRbacGuardError(new Error('rbac_last_super_admin_forbidden'))).toBe(true);
    expect(isRbacGuardError({ detail: 'rbac_target_super_admin_forbidden' })).toBe(true);
    expect(isRbacGuardError(new Error('permission denied'))).toBe(false);
  });

  it('renders provenance booleans consistently', () => {
    expect(renderBooleanLabel(true)).toBe('yes');
    expect(renderBooleanLabel(false)).toBe('no');
    expect(renderBooleanLabel('1')).toBe('yes');
    expect(renderBooleanLabel('0')).toBe('no');
  });

  it('keeps provenance integrity metadata visible in the detail list', () => {
    const entries = getAudioMetadataProvenanceEntries({
      auditId: 'audit_1',
      uid: 'uid_1',
      status: 'completed',
      audibleLabelApplied: true,
      outputSha256: 'sha256-abc',
      watermarkMode: 'audible_latent',
      watermarkId: 'watermark-1',
      watermarkVersion: 'v1',
      watermarkDetectable: true,
      c2paStatus: 'applied',
      c2paManifestRef: 'manifest://ref',
      provenanceVersion: '2026.04',
      provenanceError: '',
    } as never);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Audible label applied', value: 'yes' }),
        expect.objectContaining({ label: 'Output SHA-256', value: 'sha256-abc' }),
        expect.objectContaining({ label: 'Watermark version', value: 'v1' }),
        expect.objectContaining({ label: 'Watermark detectable', value: 'yes' }),
        expect.objectContaining({ label: 'C2PA manifest ref', value: 'manifest://ref' }),
        expect.objectContaining({ label: 'Provenance version', value: '2026.04' }),
      ])
    );
  });
});
