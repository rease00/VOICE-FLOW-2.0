'use client';

import { useEffect } from 'react';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageString } from '../../shared/storage/localStore';
import {
  applyBrandThemeToDocument,
  applyMotionLevelToDocument,
  applyThemeModeToDocument,
  readUiBrandThemeFromStorage,
  readUiMotionLevelFromStorage,
  readUiThemeModeFromStorage,
  type ResolvedUiThemeMode,
} from '../../shared/theme/themeDom';

export function AppThemeBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const themeMode = readUiThemeModeFromStorage(readStorageString(STORAGE_KEYS.uiTheme));
    const brandTheme = readUiBrandThemeFromStorage(readStorageString(STORAGE_KEYS.uiBrandTheme));
    const motionLevel = readUiMotionLevelFromStorage(readStorageString(STORAGE_KEYS.uiMotionLevel));
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyResolvedTheme = (resolvedTheme: ResolvedUiThemeMode) =>
      applyThemeModeToDocument(document, themeMode, resolvedTheme);

    let cleanupTheme = applyResolvedTheme(
      themeMode === 'system' ? (media.matches ? 'dark' : 'light') : themeMode,
    );
    const cleanupBrand = applyBrandThemeToDocument(document, brandTheme);
    const cleanupMotion = applyMotionLevelToDocument(document, motionLevel);

    if (themeMode !== 'system') {
      return () => {
        cleanupMotion();
        cleanupBrand();
        cleanupTheme();
      };
    }

    const handleSystemThemeChange = () => {
      cleanupTheme();
      cleanupTheme = applyResolvedTheme(media.matches ? 'dark' : 'light');
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleSystemThemeChange);
    } else {
      media.addListener(handleSystemThemeChange);
    }

    return () => {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', handleSystemThemeChange);
      } else {
        media.removeListener(handleSystemThemeChange);
      }
      cleanupMotion();
      cleanupBrand();
      cleanupTheme();
    };
  }, []);

  return null;
}
