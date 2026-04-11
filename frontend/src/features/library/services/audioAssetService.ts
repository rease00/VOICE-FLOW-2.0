/**
 * Audio Asset Service
 * Manages audio asset catalog and URL resolution for the Audio Director system.
 * Assets can come from R2 storage or bundled static files.
 */

export interface AudioAssetMetadata {
  id: string;
  type: 'sfx' | 'bgm';
  name: string;
  category: string;
  duration: number; // seconds
  url: string;
}

// Built-in catalog of available audio assets
// URLs point to free/public domain audio — to be replaced with R2-hosted assets
const ASSET_CATALOG: AudioAssetMetadata[] = [
  // SFX
  { id: 'thunder', type: 'sfx', name: 'Thunder', category: 'weather', duration: 3, url: '' },
  { id: 'rain', type: 'sfx', name: 'Rain', category: 'weather', duration: 5, url: '' },
  { id: 'wind', type: 'sfx', name: 'Wind', category: 'weather', duration: 4, url: '' },
  { id: 'footsteps', type: 'sfx', name: 'Footsteps', category: 'movement', duration: 2, url: '' },
  { id: 'door_creak', type: 'sfx', name: 'Door Creak', category: 'environment', duration: 1.5, url: '' },
  { id: 'glass_break', type: 'sfx', name: 'Glass Break', category: 'impact', duration: 1, url: '' },
  { id: 'horse_gallop', type: 'sfx', name: 'Horse Gallop', category: 'movement', duration: 3, url: '' },
  { id: 'sword_clash', type: 'sfx', name: 'Sword Clash', category: 'combat', duration: 1, url: '' },
  { id: 'fire_crackle', type: 'sfx', name: 'Fire Crackle', category: 'environment', duration: 4, url: '' },
  { id: 'ocean_waves', type: 'sfx', name: 'Ocean Waves', category: 'nature', duration: 5, url: '' },
  { id: 'birdsong', type: 'sfx', name: 'Birdsong', category: 'nature', duration: 4, url: '' },
  { id: 'crowd_murmur', type: 'sfx', name: 'Crowd Murmur', category: 'social', duration: 3, url: '' },
  { id: 'clock_tick', type: 'sfx', name: 'Clock Tick', category: 'environment', duration: 2, url: '' },
  { id: 'heartbeat', type: 'sfx', name: 'Heartbeat', category: 'body', duration: 2, url: '' },
  { id: 'scream', type: 'sfx', name: 'Scream', category: 'voice', duration: 1.5, url: '' },
  { id: 'laughter', type: 'sfx', name: 'Laughter', category: 'voice', duration: 2, url: '' },
  { id: 'whisper', type: 'sfx', name: 'Whisper', category: 'voice', duration: 1.5, url: '' },
  { id: 'knock', type: 'sfx', name: 'Knock', category: 'impact', duration: 1, url: '' },
  { id: 'explosion', type: 'sfx', name: 'Explosion', category: 'impact', duration: 2, url: '' },
  { id: 'church_bells', type: 'sfx', name: 'Church Bells', category: 'environment', duration: 4, url: '' },

  // BGM
  { id: 'tense_strings', type: 'bgm', name: 'Tense Strings', category: 'dramatic', duration: 120, url: '' },
  { id: 'peaceful_piano', type: 'bgm', name: 'Peaceful Piano', category: 'calm', duration: 180, url: '' },
  { id: 'epic_orchestra', type: 'bgm', name: 'Epic Orchestra', category: 'dramatic', duration: 150, url: '' },
  { id: 'dark_ambient', type: 'bgm', name: 'Dark Ambient', category: 'horror', duration: 200, url: '' },
  { id: 'romantic_waltz', type: 'bgm', name: 'Romantic Waltz', category: 'romance', duration: 160, url: '' },
  { id: 'mysterious_harp', type: 'bgm', name: 'Mysterious Harp', category: 'mystery', duration: 140, url: '' },
  { id: 'battle_drums', type: 'bgm', name: 'Battle Drums', category: 'action', duration: 100, url: '' },
  { id: 'sad_cello', type: 'bgm', name: 'Sad Cello', category: 'emotional', duration: 180, url: '' },
  { id: 'cheerful_folk', type: 'bgm', name: 'Cheerful Folk', category: 'happy', duration: 120, url: '' },
  { id: 'horror_drone', type: 'bgm', name: 'Horror Drone', category: 'horror', duration: 200, url: '' },
  { id: 'adventure_theme', type: 'bgm', name: 'Adventure Theme', category: 'action', duration: 150, url: '' },
  { id: 'suspense_piano', type: 'bgm', name: 'Suspense Piano', category: 'mystery', duration: 140, url: '' },
  { id: 'carnival_music', type: 'bgm', name: 'Carnival Music', category: 'happy', duration: 100, url: '' },
  { id: 'lullaby', type: 'bgm', name: 'Lullaby', category: 'calm', duration: 180, url: '' },
  { id: 'storm_ambience', type: 'bgm', name: 'Storm Ambience', category: 'weather', duration: 200, url: '' },
];

// R2 base URL — to be configured when R2 bucket is set up
const R2_BASE_URL = process.env.NEXT_PUBLIC_R2_AUDIO_URL || '';

export function getAssetCatalog(): AudioAssetMetadata[] {
  return ASSET_CATALOG;
}

export function getAssetsByCatalogType(type: 'sfx' | 'bgm'): AudioAssetMetadata[] {
  return ASSET_CATALOG.filter((a) => a.type === type);
}

export function resolveAssetUrl(id: string, type: 'sfx' | 'bgm'): string | null {
  const asset = ASSET_CATALOG.find((a) => a.id === id && a.type === type);
  if (!asset) return null;

  // If asset has a direct URL, use it
  if (asset.url) return asset.url;

  // Fall back to R2 if configured
  if (R2_BASE_URL) {
    return `${R2_BASE_URL}/${type}/${id}.mp3`;
  }

  // No URL available
  return null;
}

export function getAssetMetadata(id: string): AudioAssetMetadata | undefined {
  return ASSET_CATALOG.find((a) => a.id === id);
}
