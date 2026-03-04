export const STORAGE_KEYS = {
  settings: 'vf_settings',
  stats: 'vf_stats',
  characterLibrary: 'vf_character_lib',
  authIntent: 'vf_auth_intent',
  uidSetupRequired: 'vf_uid_setup_required',
  uiTheme: 'vf_ui_theme',
  uiDensity: 'vf_ui_density',
  uiFontScale: 'vf_ui_font_scale',
  uiMotionLevel: 'vf_ui_motion_level',
  studioEditorMode: 'vf_studio_editor_mode',
  localAdminSession: 'vf_local_admin_session',
  driveGoogleTokenCache: 'vf_drive_google_token_cache',
  clonedVoices: 'vf_clones',
  notifications: 'vf_notifications',
  notificationPrefs: 'vf_notification_prefs',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
