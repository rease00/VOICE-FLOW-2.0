import type { ReaderResolvedTheme } from './readerTypes';

export const getReaderThemeClassName = (resolvedTheme: ReaderResolvedTheme): string =>
  `vf-reader vf-reader--${resolvedTheme}`;
