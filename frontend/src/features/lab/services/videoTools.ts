const parseBooleanFlag = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const COMMERCIAL_MODE_ENABLED = parseBooleanFlag(import.meta.env.VITE_VF_COMMERCIAL_MODE, true);
const VIDEO_EXTRACT_FLAG_RAW = String(import.meta.env.VITE_LAB_VIDEO_EXTRACT_ENABLED ?? '').trim();
const VIDEO_EXTRACT_FLAG_SET = VIDEO_EXTRACT_FLAG_RAW.length > 0;
const VIDEO_EXTRACT_ENABLED = VIDEO_EXTRACT_FLAG_SET
  ? parseBooleanFlag(VIDEO_EXTRACT_FLAG_RAW, false)
  : !COMMERCIAL_MODE_ENABLED;

const createAbortError = (): DOMException => new DOMException('Aborted', 'AbortError');

const waitForEvent = (
  target: EventTarget,
  eventName: string,
  signal?: AbortSignal
): Promise<void> => new Promise<void>((resolve, reject) => {
  let settled = false;
  const cleanup = (): void => {
    target.removeEventListener(eventName, onDone);
    signal?.removeEventListener('abort', onAbort);
  };
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    cleanup();
    callback();
  };
  const onDone = (): void => finish(resolve);
  const onAbort = (): void => finish(() => reject(createAbortError()));
  target.addEventListener(eventName, onDone, { once: true });
  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  }
});

const resolveRecorderMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
};

export const isLabVideoAudioExtractionEnabled = (): boolean => VIDEO_EXTRACT_ENABLED;

export const getLabVideoAudioExtractionDisabledReason = (): string | null => {
  if (VIDEO_EXTRACT_ENABLED) return null;
  if (COMMERCIAL_MODE_ENABLED) {
    return 'Video-to-audio extraction is disabled in strict commercial mode until a compliant backend replacement is approved.';
  }
  return 'Video-to-audio extraction is disabled by configuration.';
};

export const extractAudioFromVideoFile = async (
  file: File,
  options?: {
    signal?: AbortSignal;
    onProgress?: (payload: { progressPct: number; message: string }) => void;
  }
): Promise<Blob> => {
  const disabledReason = getLabVideoAudioExtractionDisabledReason();
  if (disabledReason) {
    throw new Error(disabledReason);
  }
  if (typeof document === 'undefined') {
    throw new Error('Video extraction requires a browser environment.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support MediaRecorder-based video extraction.');
  }

  options?.onProgress?.({
    progressPct: 3,
    message: 'Preparing local media pipeline...',
  });

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  const cleanupTracks = (stream: MediaStream | null): void => {
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore cleanup failures.
      }
    });
  };

  let progressTimer: number | null = null;
  let sourceStream: MediaStream | null = null;
  let audioStream: MediaStream | null = null;

  try {
    await waitForEvent(video, 'loadedmetadata', options?.signal);
    if (options?.signal?.aborted) throw createAbortError();
    const streamCapableVideo = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const capture = streamCapableVideo.captureStream || streamCapableVideo.mozCaptureStream;
    if (typeof capture !== 'function') {
      throw new Error('This browser cannot capture media streams from video elements.');
    }
    const capturedStream = capture.call(video);
    if (!capturedStream || typeof capturedStream.getAudioTracks !== 'function') {
      throw new Error('This browser cannot capture media streams from video elements.');
    }
    sourceStream = capturedStream;
    const audioTracks = capturedStream.getAudioTracks();
    if (!audioTracks.length) {
      throw new Error('The selected video does not expose an audio track for extraction.');
    }
    audioStream = new MediaStream(audioTracks);

    const recorderMimeType = resolveRecorderMimeType();
    const recorder = new MediaRecorder(audioStream, recorderMimeType ? { mimeType: recorderMimeType } : undefined);
    const chunks: BlobPart[] = [];
    let recorderError: unknown = null;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('error', (event) => {
      recorderError = (event as ErrorEvent).error || new Error('MediaRecorder failed during extraction.');
    });

    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener('stop', () => {
        if (recorderError) {
          reject(recorderError);
          return;
        }
        const blobType = recorder.mimeType || recorderMimeType || 'audio/webm';
        resolve(new Blob(chunks, { type: blobType }));
      }, { once: true });
    });

    progressTimer = window.setInterval(() => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        options?.onProgress?.({ progressPct: 35, message: 'Extracting audio track from video...' });
        return;
      }
      const ratio = Math.max(0, Math.min(1, video.currentTime / video.duration));
      options?.onProgress?.({
        progressPct: Math.max(8, Math.min(95, Math.round(ratio * 95))),
        message: 'Extracting audio track from video...',
      });
    }, 220);

    const stopRecorder = (): void => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    };
    const onAbort = (): void => {
      try {
        video.pause();
      } catch {
        // Ignore pause failures.
      }
      stopRecorder();
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      recorder.start(200);
      await video.play();
      await waitForEvent(video, 'ended', options?.signal);
    } finally {
      options?.signal?.removeEventListener('abort', onAbort);
      stopRecorder();
    }

    const result = await stopped;
    options?.onProgress?.({
      progressPct: 100,
      message: 'Audio extraction complete.',
    });
    return result;
  } finally {
    if (progressTimer !== null) window.clearInterval(progressTimer);
    cleanupTracks(audioStream);
    cleanupTracks(sourceStream);
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
};
