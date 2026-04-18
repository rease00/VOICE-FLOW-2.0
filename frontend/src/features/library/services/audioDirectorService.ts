/**
 * Audio Director Service
 * Uses Gemini AI to analyze book text and insert audio cue tags.
 * Tags: [AUDIO_SFX:id] for sound effects, [AUDIO_BGM:id:action] for background music
 */

export interface AudioCue {
  type: 'sfx' | 'bgm';
  id: string;
  action?: 'play' | 'stop' | 'crossfade';
  position: number; // character offset in text
  confidence: number; // 0-1 how confident the AI was
}

export interface SceneAnalysis {
  scenes: Array<{
    startOffset: number;
    endOffset: number;
    mood: string;
    setting: string;
    intensity: number; // 0-1
  }>;
  cues: AudioCue[];
  annotatedText: string;
}

const DIRECTOR_SYSTEM_PROMPT = `You are an audio director for audiobooks. Analyze the given text and identify:
1. Scene changes (setting, mood, intensity)
2. Where sound effects would enhance the experience
3. Where background music should change

Insert tags directly into the text:
- [AUDIO_SFX:thunder] — for a thunder sound effect
- [AUDIO_BGM:tense_strings:play] — start tense background music
- [AUDIO_BGM:tense_strings:stop] — stop the background music
- [AUDIO_BGM:peaceful_piano:crossfade] — crossfade to new music

Available SFX IDs: thunder, rain, wind, footsteps, door_creak, glass_break, horse_gallop, 
sword_clash, fire_crackle, ocean_waves, birdsong, crowd_murmur, clock_tick, heartbeat,
scream, laughter, whisper, knock, explosion, church_bells

Available BGM IDs: tense_strings, peaceful_piano, epic_orchestra, dark_ambient, 
romantic_waltz, mysterious_harp, battle_drums, sad_cello, cheerful_folk, horror_drone,
adventure_theme, suspense_piano, carnival_music, lullaby, storm_ambience

Return the text with tags inserted at appropriate positions. Be tasteful — don't over-tag.
Maximum 1 SFX per paragraph, maximum 1 BGM change per scene transition.`;

export async function analyzeTextForAudioCues(
  text: string,
  directorNotes?: string
): Promise<SceneAnalysis> {
  const prompt = directorNotes
    ? `${DIRECTOR_SYSTEM_PROMPT}\n\nDirector notes: ${directorNotes}\n\nText to analyze:\n${text.slice(0, 15000)}`
    : `${DIRECTOR_SYSTEM_PROMPT}\n\nText to analyze:\n${text.slice(0, 15000)}`;

  try {
    const res = await fetch('/api/ai-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 15000), directorNotes: prompt }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error('Audio analysis failed');
    const data = (await res.json()) as { annotatedText: string };
    const annotatedText = data.annotatedText || text;

    // Parse cues from annotated text
    const cues = parseAudioCuesFromText(annotatedText);
    const scenes = inferScenesFromCues(cues, text);

    return { scenes, cues, annotatedText };
  } catch {
    return { scenes: [], cues: [], annotatedText: text };
  }
}

function parseAudioCuesFromText(text: string): AudioCue[] {
  const cues: AudioCue[] = [];
  const sfxRegex = /\[AUDIO_SFX:(\w+)\]/g;
  const bgmRegex = /\[AUDIO_BGM:(\w+):(\w+)\]/g;

  let match: RegExpExecArray | null;

  while ((match = sfxRegex.exec(text)) !== null) {
    cues.push({
      type: 'sfx',
      id: match[1]!,
      position: match.index,
      confidence: 0.8,
    });
  }

  while ((match = bgmRegex.exec(text)) !== null) {
    cues.push({
      type: 'bgm',
      id: match[1]!,
      action: match[2]! as 'play' | 'stop' | 'crossfade',
      position: match.index,
      confidence: 0.8,
    });
  }

  return cues.sort((a, b) => a.position - b.position);
}

function inferScenesFromCues(
  cues: AudioCue[],
  _text: string
): SceneAnalysis['scenes'] {
  const bgmCues = cues.filter((c) => c.type === 'bgm' && c.action === 'play');
  if (bgmCues.length === 0) return [];

  return bgmCues.map((cue, i) => {
    const nextCue = bgmCues[i + 1];
    return {
      startOffset: cue.position,
      endOffset: nextCue?.position ?? cue.position + 2000,
      mood: cue.id.replace(/_/g, ' '),
      setting: 'inferred',
      intensity: 0.5 + Math.random() * 0.3,
    };
  });
}

export function stripAudioTags(text: string): string {
  return text.replace(/\[AUDIO_(?:SFX|BGM):\w+(?::\w+)?\]/g, '');
}
