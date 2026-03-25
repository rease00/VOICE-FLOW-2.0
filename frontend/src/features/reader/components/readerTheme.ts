import type { ReaderResolvedTheme } from './readerTypes';

export const getReaderThemeClassName = (resolvedTheme: ReaderResolvedTheme): string =>
  `vf-reader-v2 vf-reader-v2--${resolvedTheme}`;
