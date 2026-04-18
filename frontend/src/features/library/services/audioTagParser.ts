/**
 * Audio Tag Parser
 * Parses [AUDIO_SFX:id] and [AUDIO_BGM:id:action] tags from annotated text
 * and builds a playback schedule for the audio engine.
 */

export interface AudioTag {
  type: 'sfx' | 'bgm';
  id: string;
  action: 'play' | 'stop' | 'crossfade';
  charOffset: number;
}

export interface PlaybackScheduleItem {
  tag: AudioTag;
  /** Estimated time offset in seconds (based on reading speed) */
  timeOffset: number;
  /** Chunk index this tag falls into */
  chunkIndex: number;
  /** Position within the chunk (0-1) */
  chunkPosition: number;
}

const TAG_REGEX = /\[AUDIO_(SFX|BGM):(\w+)(?::(\w+))?\]/g;
const CHARS_PER_SECOND = 15; // average reading speed ~900 chars/minute

export function parseTags(text: string): AudioTag[] {
  const tags: AudioTag[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(TAG_REGEX.source, TAG_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    tags.push({
      type: match[1]!.toLowerCase() as 'sfx' | 'bgm',
      id: match[2]!,
      action: (match[3] as AudioTag['action']) || 'play',
      charOffset: match.index,
    });
  }

  return tags;
}

export function buildPlaybackSchedule(
  tags: AudioTag[],
  chunkBoundaries: number[],
  readingSpeed = CHARS_PER_SECOND
): PlaybackScheduleItem[] {
  return tags.map((tag) => {
    const timeOffset = tag.charOffset / readingSpeed;

    // Find which chunk this tag belongs to
    let chunkIndex = 0;
    for (let i = 0; i < chunkBoundaries.length; i++) {
      if (tag.charOffset < chunkBoundaries[i]!) break;
      chunkIndex = i;
    }

    const chunkStart = chunkIndex > 0 ? chunkBoundaries[chunkIndex - 1]! : 0;
    const chunkEnd = chunkBoundaries[chunkIndex] ?? tag.charOffset + 1;
    const chunkPosition = (tag.charOffset - chunkStart) / Math.max(1, chunkEnd - chunkStart);

    return { tag, timeOffset, chunkIndex, chunkPosition: Math.min(1, Math.max(0, chunkPosition)) };
  });
}

export function stripTags(text: string): string {
  return text.replace(/\[AUDIO_(?:SFX|BGM):\w+(?::\w+)?\]/g, '');
}
