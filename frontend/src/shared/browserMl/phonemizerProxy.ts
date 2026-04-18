import { readEnvValue } from '../runtime/env';

const DEFAULT_BROWSER_PHONEMIZER_URL = 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js';

type PhonemizeFn = (text: string, language?: string, options?: unknown) => Promise<string[]>;

let phonemizerModulePromise: Promise<{ phonemize: PhonemizeFn }> | null = null;

const resolveBrowserPhonemizerUrl = (): string => {
  const configured = readEnvValue(process.env.NEXT_PUBLIC_BROWSER_PHONEMIZER_URL);
  return configured || DEFAULT_BROWSER_PHONEMIZER_URL;
};

const loadBrowserPhonemizer = async (): Promise<{ phonemize: PhonemizeFn }> => {
  if (!phonemizerModulePromise) {
    const url = resolveBrowserPhonemizerUrl();
    phonemizerModulePromise = import(/* webpackIgnore: true */ url) as Promise<{ phonemize: PhonemizeFn }>;
  }
  return phonemizerModulePromise;
};

export const phonemize: PhonemizeFn = async (text, language, options) => {
  const module = await loadBrowserPhonemizer();
  return module.phonemize(text, language, options);
};
