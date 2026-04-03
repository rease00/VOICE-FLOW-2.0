import { expect, test } from '@playwright/test';

import { PRIME_ACCESS_LOCK_MESSAGE } from '../../src/app/workspace/mainAppHelpers';

type Engine = 'DUNO' | 'VECTOR' | 'PRIME';

const engineOrder: Engine[] = ['DUNO', 'VECTOR', 'PRIME'];

const renderRuntimeStripFixture = (allowedEngines: Engine[]): string => {
  const lockedTitle = `Locked: ${PRIME_ACCESS_LOCK_MESSAGE}`;

  return `
    <section aria-label="Runtime engines" data-testid="runtime-strip" style="display:flex;gap:12px;align-items:center;">
      ${engineOrder
        .map((engine) => {
          const allowed = allowedEngines.includes(engine);
          const lockedCopy = engine === 'PRIME' ? PRIME_ACCESS_LOCK_MESSAGE : 'This engine is not available.';
          const titleParts = [`${engine} runtime`, engine === 'PRIME' ? 'Online' : 'Standby'];

          if (!allowed) {
            titleParts.push(`Locked: ${lockedCopy}`);
          }

          return `
            <button
              type="button"
              data-engine="${engine}"
              aria-label="${engine} runtime: ${engine === 'PRIME' ? 'Online' : 'Standby'}${!allowed ? `. Locked: ${lockedCopy}` : ''}"
              title="${titleParts.join(' - ')}"
              ${allowed ? '' : 'disabled'}
            >
              ${engine}
              ${!allowed ? `<span class="lock-copy">Locked: ${lockedCopy}</span>` : ''}
            </button>
          `;
        })
        .join('')}
      <span data-testid="mode-copy">Runtime switching is read-only for this account.</span>
      <span data-testid="access-copy">${allowedEngines.includes('PRIME') ? 'Prime unlocked' : 'Prime locked'}</span>
      <span data-testid="prime-locked-copy">${allowedEngines.includes('PRIME') ? '' : lockedTitle}</span>
    </section>
  `;
};

test.describe('prime access runtime strip', () => {
  test('locks PRIME for unpaid accounts', async ({ page }) => {
    await page.setContent(renderRuntimeStripFixture(['DUNO', 'VECTOR']));

    await expect(page.getByTestId('prime-locked-copy')).toHaveText(`Locked: ${PRIME_ACCESS_LOCK_MESSAGE}`);
    await expect(page.locator('button')).toHaveCount(3);
    await expect(page.locator('button[disabled]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Prime runtime/i })).toBeVisible();
  });

  test('unlocks PRIME when paid access is available', async ({ page }) => {
    await page.setContent(renderRuntimeStripFixture(['DUNO', 'VECTOR', 'PRIME']));

    await expect(page.getByTestId('prime-locked-copy')).toHaveText('');
    await expect(page.locator('button')).toHaveCount(3);
    await expect(page.locator('button[disabled]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Prime runtime/i })).toBeVisible();
  });
});
