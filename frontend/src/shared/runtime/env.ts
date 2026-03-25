const normalizeEnvValue = (value: unknown): string => String(value ?? '').trim();

export const readEnvValue = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const token = normalizeEnvValue(value);
    if (token) return token;
  }
  return '';
};

export const readEnvBoolean = (...values: Array<string | undefined>): boolean | undefined => {
  const raw = readEnvValue(...values);
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

export const readEnvNumber = (...values: Array<string | undefined>): number | undefined => {
  const raw = readEnvValue(...values);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const readEnvCsv = (...values: Array<string | undefined>): string[] =>
  readEnvValue(...values)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
