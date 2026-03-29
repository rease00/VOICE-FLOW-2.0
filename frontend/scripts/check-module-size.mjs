#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const budgets = [
  { file: 'views/MainApp.tsx', maxLines: 10000 },
  { file: 'app/(app)/app/app-shell.css', maxLines: 2200 },
];

const countLines = (content) => {
  if (!content.length) return 0;
  return content.replace(/\r\n/g, '\n').split('\n').length;
};

const formatPath = (relativePath) => relativePath.replace(/\\/g, '/');

const main = async () => {
  const violations = [];
  for (const budget of budgets) {
    const absolutePath = path.join(ROOT, budget.file);
    const raw = await fs.readFile(absolutePath, 'utf8');
    const lines = countLines(raw);
    if (lines > budget.maxLines) {
      violations.push({ ...budget, lines });
    }
    console.log(`[maintainability] ${formatPath(budget.file)}: ${lines} lines (max ${budget.maxLines})`);
  }

  if (violations.length > 0) {
    console.error('[maintainability] module size budget exceeded:');
    for (const violation of violations) {
      console.error(`- ${formatPath(violation.file)} has ${violation.lines} lines (max ${violation.maxLines})`);
    }
    process.exit(1);
  }

  console.log('[maintainability] size budgets passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
