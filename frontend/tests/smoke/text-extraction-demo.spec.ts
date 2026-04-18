import { test } from '@playwright/test';

test('extract all text from body using innerText()', async ({ page }) => {
  // 1. Navigate to the landing page
  await page.goto('/');

  // 2. Use page.locator('body').innerText() to get the text
  const bodyText = await page.locator('body').innerText();

  // 3. Console log the result
  console.log('--- Extracted Body Text ---');
  console.log(bodyText);
  console.log('--- End of Extracted Text ---');
});
