import { readEnvValue } from '../runtime/env';

interface AudioCatalogEntry {
  id: string;
  assetPath: string;
  previewUrl?: string;
  assetUrl?: string;
}

interface AudioCatalogPayload {
  musicTracks?: AudioCatalogEntry[];
  sfx?: AudioCatalogEntry[];
}

let audioCatalogPromise: Promise<AudioCatalogPayload | null> | null = null;

const getAudioCatalog = async (): Promise<AudioCatalogPayload | null> => {
  if (!audioCatalogPromise) {
    audioCatalogPromise = fetch('/config/audio-catalog.json', { cache: 'force-cache' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<AudioCatalogPayload>;
      })
      .catch(() => null);
  }
  return audioCatalogPromise;
};

const resolveAssetPath = (entry: AudioCatalogEntry | null | undefined, fallbackUrl: string): string => {
  const cdnBase = readEnvValue(process.env.NEXT_PUBLIC_AUDIO_CDN_BASE_URL).replace(/\/+$/, '');
  const explicitAssetUrl = String(entry?.assetUrl || '').trim();
  if (explicitAssetUrl) return explicitAssetUrl;
  const assetPath = String(entry?.assetPath || '').trim() || String(fallbackUrl || '').trim();
  if (!assetPath) return '';
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  if (!cdnBase) return assetPath;
  return `${cdnBase}${assetPath.startsWith('/') ? assetPath : `/${assetPath}`}`;
};

export const resolveMusicTrackUrlById = async (trackId: string, fallbackUrl: string = ''): Promise<string> => {
  const safeTrackId = String(trackId || '').trim();
  if (!safeTrackId || safeTrackId === 'm_none') return '';
  const catalog = await getAudioCatalog();
  const match = (catalog?.musicTracks || []).find((entry) => entry.id === safeTrackId);
  return resolveAssetPath(match, fallbackUrl);
};
