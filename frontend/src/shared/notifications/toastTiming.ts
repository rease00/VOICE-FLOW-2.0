import type { AppNotification } from './types';

export const TOAST_AUTO_HIDE_MS = 3000;

export const getToastAutoHideMs = (_item: AppNotification): number => TOAST_AUTO_HIDE_MS;
