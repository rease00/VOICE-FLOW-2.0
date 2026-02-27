import type { StorageKey } from './keys';

export const readStorageString = (key: StorageKey): string => {
  try {
    return String(localStorage.getItem(key) || '');
  } catch {
    return '';
  }
};

export const writeStorageString = (key: StorageKey, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // no-op
  }
};

export const removeStorageKey = (key: StorageKey): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // no-op
  }
};

export const readStorageJson = <T>(key: StorageKey): T | null => {
  const raw = readStorageString(key);
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const writeStorageJson = (key: StorageKey, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
};
