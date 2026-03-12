import type { LabAsset, LabClip, LabCanvasState } from '../../../../types';
import { getSharedAudioContext } from '../../../shared/audio/audioContext';
import { getClipDurationMs } from '../model/session';

interface LocalExportOptions {
  canvas: LabCanvasState;
  assets: LabAsset[];
  clips: LabClip[];
  audioBlob?: Blob | null;
  signal?: AbortSignal;
  onProgress?: (payload: { progressPct: number; message: string }) => void;
  resolveAssetBlob?: (assetId: string) => Promise<Blob | null>;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isVisualKind = (kind: LabAsset['kind']): boolean => (
  kind === 'video' || kind === 'image' || kind === 'text' || kind === 'element' || kind === 'recording'
);

const chooseRecorderMimeType = (): string => {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return 'video/webm';
};

const computeRect = (
  clip: LabClip,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } => {
  const transform = clip.stageTransform;
  const w = Math.max(32, (width * clamp(transform.widthPercent, 4, 100)) / 100) * clamp(transform.scale, 0.2, 3);
  const h = Math.max(32, (height * clamp(transform.heightPercent, 4, 100)) / 100) * clamp(transform.scale, 0.2, 3);
  return {
    x: ((width * clamp(transform.xPercent, 0, 100)) / 100) - (w / 2),
    y: ((height * clamp(transform.yPercent, 0, 100)) / 100) - (h / 2),
    w,
    h,
  };
};

const loadImage = async (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for Lab export.'));
    image.src = src;
  });
};

const loadVideo = async (src: string): Promise<HTMLVideoElement> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error('Failed to load video for Lab export.'));
    video.src = src;
  });
};

const loadVisualAssetEntries = async (
  assets: LabAsset[],
  resolveAssetBlob?: (assetId: string) => Promise<Blob | null>
): Promise<Map<string, { image?: HTMLImageElement; video?: HTMLVideoElement; revokeUrl?: string }>> => {
  const entries = new Map<string, { image?: HTMLImageElement; video?: HTMLVideoElement; revokeUrl?: string }>();
  for (const asset of assets) {
    if (!isVisualKind(asset.kind) || asset.kind === 'text' || asset.kind === 'element') continue;
    let src = String(asset.objectUrl || '').trim();
    let revokeUrl = '';
    if (!src && resolveAssetBlob) {
      const blob = await resolveAssetBlob(asset.id);
      if (blob) {
        src = URL.createObjectURL(blob);
        revokeUrl = src;
      }
    }
    if (!src) continue;
    if (asset.kind === 'image') {
      entries.set(asset.id, { image: await loadImage(src), ...(revokeUrl ? { revokeUrl } : {}) });
    } else {
      entries.set(asset.id, { video: await loadVideo(src), ...(revokeUrl ? { revokeUrl } : {}) });
    }
  }
  return entries;
};

const drawTextBlock = (
  ctx: CanvasRenderingContext2D,
  clip: LabClip,
  asset: LabAsset,
  width: number,
  height: number
): void => {
  const style = asset.textStyle;
  if (!style) return;
  const rect = computeRect(clip, width, height);
  ctx.save();
  ctx.globalAlpha = clamp(clip.stageTransform.opacity, 0, 1);
  ctx.translate(rect.x + (rect.w / 2), rect.y + (rect.h / 2));
  ctx.rotate((clip.stageTransform.rotationDeg * Math.PI) / 180);
  const fontSize = Math.max(16, style.fontSize * (height / 1080));
  ctx.font = `${style.fontWeight} ${Math.round(fontSize)}px "${style.fontFamily}"`;
  ctx.textAlign = style.textAlign;
  ctx.textBaseline = 'middle';
  if (style.backgroundColor) {
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(-(rect.w / 2), -(rect.h / 2), rect.w, rect.h);
  }
  if (style.shadow) {
    ctx.shadowColor = 'rgba(15, 23, 42, 0.38)';
    ctx.shadowBlur = 18;
  }
  if (style.strokeColor && style.strokeWidth) {
    ctx.lineWidth = style.strokeWidth;
    ctx.strokeStyle = style.strokeColor;
    ctx.strokeText(style.text, 0, 0, rect.w - 24);
  }
  ctx.fillStyle = style.color;
  ctx.fillText(style.text, 0, 0, rect.w - 24);
  ctx.restore();
};

const drawElementBlock = (
  ctx: CanvasRenderingContext2D,
  clip: LabClip,
  asset: LabAsset,
  width: number,
  height: number
): void => {
  const style = asset.elementStyle;
  if (!style) return;
  const rect = computeRect(clip, width, height);
  ctx.save();
  ctx.globalAlpha = clamp(clip.stageTransform.opacity, 0, 1);
  ctx.translate(rect.x + (rect.w / 2), rect.y + (rect.h / 2));
  ctx.rotate((clip.stageTransform.rotationDeg * Math.PI) / 180);
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke || 'transparent';
  ctx.lineWidth = style.strokeWidth || 0;
  if (style.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(rect.w, rect.h) / 2, 0, Math.PI * 2);
    ctx.fill();
    if (style.stroke) ctx.stroke();
  } else {
    const radius = style.shape === 'pill' ? rect.h / 2 : Math.max(8, style.radius || 18);
    if (style.shape === 'frame') {
      ctx.strokeStyle = style.stroke || style.fill;
      ctx.lineWidth = style.strokeWidth || 8;
      ctx.strokeRect(-(rect.w / 2), -(rect.h / 2), rect.w, rect.h);
    } else {
      ctx.beginPath();
      ctx.roundRect(-(rect.w / 2), -(rect.h / 2), rect.w, rect.h, radius);
      ctx.fill();
      if (style.stroke) ctx.stroke();
    }
  }
  ctx.restore();
};

const drawVisualFrame = async (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeMs: number,
  canvas: LabCanvasState,
  assets: Map<string, LabAsset>,
  clips: LabClip[],
  loadedAssets: Map<string, { image?: HTMLImageElement; video?: HTMLVideoElement }>
): Promise<void> => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = canvas.background;
  ctx.fillRect(0, 0, width, height);
  const activeVisualClips = clips
    .filter((clip) => clip.visible && clip.enabled)
    .filter((clip) => {
      const asset = assets.get(clip.assetId);
      if (!asset || !isVisualKind(asset.kind)) return false;
      const endMs = clip.startMs + getClipDurationMs(clip);
      return timeMs >= clip.startMs && timeMs <= endMs;
    })
    .sort((left, right) => left.stageTransform.zIndex - right.stageTransform.zIndex);

  for (const clip of activeVisualClips) {
    const asset = assets.get(clip.assetId);
    if (!asset) continue;
    const rect = computeRect(clip, width, height);
    ctx.save();
    ctx.globalAlpha = clamp(clip.stageTransform.opacity, 0, 1);
    ctx.translate(rect.x + (rect.w / 2), rect.y + (rect.h / 2));
    ctx.rotate((clip.stageTransform.rotationDeg * Math.PI) / 180);
    if (asset.kind === 'image') {
      const image = loadedAssets.get(asset.id)?.image;
      if (image) ctx.drawImage(image, -(rect.w / 2), -(rect.h / 2), rect.w, rect.h);
      ctx.restore();
      continue;
    }
    if (asset.kind === 'video' || asset.kind === 'recording') {
      const video = loadedAssets.get(asset.id)?.video;
      if (video) {
        const clipOffsetMs = Math.max(0, timeMs - clip.startMs);
        const clipTimeSec = clamp((clip.trimStartMs + (clipOffsetMs * Math.max(0.25, clip.playbackRate))) / 1000, 0, Math.max(0, video.duration || 0));
        if (Math.abs((video.currentTime || 0) - clipTimeSec) > 0.08) {
          video.currentTime = clipTimeSec;
        }
        ctx.drawImage(video, -(rect.w / 2), -(rect.h / 2), rect.w, rect.h);
      }
      ctx.restore();
      continue;
    }
    ctx.restore();
    if (asset.kind === 'text') {
      drawTextBlock(ctx, clip, asset, width, height);
      continue;
    }
    if (asset.kind === 'element') {
      drawElementBlock(ctx, clip, asset, width, height);
    }
  }
};

export const exportLabCompositionLocally = async ({
  canvas,
  assets,
  clips,
  audioBlob,
  signal,
  onProgress,
  resolveAssetBlob,
}: LocalExportOptions): Promise<Blob> => {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support local Lab video export.');
  }
  const durationMs = Math.max(
    1000,
    clips.reduce((max, clip) => Math.max(max, clip.startMs + getClipDurationMs(clip)), 0)
  );
  const scale = Math.min(1, 1280 / Math.max(canvas.width, 1));
  const exportWidth = Math.max(640, Math.round(canvas.width * scale));
  const exportHeight = Math.max(360, Math.round(canvas.height * scale));
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportWidth;
  exportCanvas.height = exportHeight;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas export context is unavailable.');
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const loadedAssets = await loadVisualAssetEntries(assets, resolveAssetBlob);
  const stream = exportCanvas.captureStream(24);
  const cleanupUrls = () => {
    loadedAssets.forEach((entry) => {
      if (entry.revokeUrl) URL.revokeObjectURL(entry.revokeUrl);
    });
  };

  let audioElement: HTMLAudioElement | null = null;
  let audioUrl = '';
  let animationFrame = 0;
  try {
    if (audioBlob) {
      const context = getSharedAudioContext();
      audioUrl = URL.createObjectURL(audioBlob);
      audioElement = new Audio(audioUrl);
      audioElement.crossOrigin = 'anonymous';
      const sourceNode = context.createMediaElementSource(audioElement);
      const destination = context.createMediaStreamDestination();
      sourceNode.connect(destination);
      sourceNode.connect(context.destination);
      destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      await context.resume();
    }

    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Lab export recorder failed.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    const startedAt = performance.now();
    const renderLoop = async () => {
      if (signal?.aborted) {
        recorder.stop();
        return;
      }
      const elapsedMs = audioElement
        ? Math.round((audioElement.currentTime || 0) * 1000)
        : Math.round(performance.now() - startedAt);
      await drawVisualFrame(ctx, exportWidth, exportHeight, elapsedMs, canvas, assetMap, clips, loadedAssets);
      onProgress?.({
        progressPct: Math.round(clamp((elapsedMs / durationMs) * 100, 0, 100)),
        message: 'Capturing Lab canvas locally...',
      });
      if (elapsedMs >= durationMs) {
        recorder.stop();
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        void renderLoop();
      });
    };

    recorder.start(250);
    if (audioElement) {
      await audioElement.play();
      audioElement.onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
    }
    void renderLoop();
    return await done;
  } finally {
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute('src');
      audioElement.load();
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    cleanupUrls();
  }
};
