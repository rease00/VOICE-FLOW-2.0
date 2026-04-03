import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EngineRuntimeStrip } from '../components/EngineRuntimeStrip';
import { PRIME_ACCESS_LOCK_MESSAGE } from '../src/app/workspace/mainAppHelpers';

describe('EngineRuntimeStrip read-only mode', () => {
  it('renders disabled controls and a lock hint when runtime switching is read-only', () => {
    const html = renderToStaticMarkup(
      <EngineRuntimeStrip
        engineOrder={['DUNO', 'VECTOR', 'PRIME']}
        statuses={{
          DUNO: { state: 'online', detail: 'Online' },
          VECTOR: { state: 'standby', detail: 'Standby' },
          PRIME: { state: 'offline', detail: 'Offline' },
        }}
        accessState={{ blocked: false, detail: '' }}
        allowedEngines={['DUNO', 'VECTOR']}
        readOnly
        readOnlyHint="Runtime switching is read-only for this account (ops.mutate required)."
        activeEngine="DUNO"
        switchingEngine={null}
        compact={false}
        resolvedTheme="light"
        onActivate={vi.fn()}
      />
    );

    expect(html).toContain('Read-only: Runtime switching is read-only for this account (ops.mutate required).');
    const disabledCount = (html.match(/disabled=\"\"/g) || []).length;
    expect(disabledCount).toBe(3);
  });

  it('locks PRIME when the account does not have paid access', () => {
    const html = renderToStaticMarkup(
      <EngineRuntimeStrip
        engineOrder={['DUNO', 'VECTOR', 'PRIME']}
        statuses={{
          DUNO: { state: 'online', detail: 'Online' },
          VECTOR: { state: 'standby', detail: 'Standby' },
          PRIME: { state: 'offline', detail: 'Offline' },
        }}
        accessState={{ blocked: false, detail: '' }}
        allowedEngines={['DUNO', 'VECTOR']}
        activeEngine="DUNO"
        switchingEngine={null}
        compact={false}
        resolvedTheme="light"
        onActivate={vi.fn()}
      />
    );

    expect(html).toContain(`Locked: ${PRIME_ACCESS_LOCK_MESSAGE}`);
    expect(html).toContain('Prime runtime: Offline. Locked:');
    const disabledCount = (html.match(/disabled=\"\"/g) || []).length;
    expect(disabledCount).toBe(1);
  });
});
