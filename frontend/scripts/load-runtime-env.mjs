import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const ENV_FILE_NAMES = ['.env.local'];

const parseEnvValue = (rawValue) => {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return '';

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0];
    const inner = trimmed.slice(1, -1);
    if (quote === '"') {
      return inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"');
    }
    return inner;
  }

  return trimmed;
};

const parseDotEnv = (content) => {
  const entries = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    entries[key] = parseEnvValue(rawValue);
  }
  return entries;
};

export const loadRuntimeEnv = (rootDir = frontendRoot) => {
  const loaded = {};
  for (const fileName of ENV_FILE_NAMES) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    Object.assign(loaded, parseDotEnv(fs.readFileSync(filePath, 'utf8')));
  }
  return loaded;
};

export const createRuntimeEnv = (baseEnv = process.env, rootDir = frontendRoot) => ({
  ...baseEnv,
  ...loadRuntimeEnv(rootDir),
});

export const applyRuntimeEnv = (rootDir = frontendRoot) => {
  const loaded = loadRuntimeEnv(rootDir);
  for (const [key, value] of Object.entries(loaded)) {
    process.env[key] = value;
  }
  return loaded;
};
