import { GoogleGenAI, Modality, Type } from "@google/genai";
import { GenerationSettings, RemoteSpeaker, ClonedVoice, CharacterProfile } from "../types";
import { VOICES, MUSIC_TRACKS, EMOTIONS, LANGUAGES, SFX_LIBRARY, OPENAI_VOICES, F5_VOICES } from "../constants";
import { f5OnnxEngine } from "./f5OnnxService";

// Safely access API Key to prevent ReferenceError in strict browser environments
const SYSTEM_API_KEY = (() => {
  try {
    return (typeof process !== 'undefined' && process.env && process.env.API_KEY) ? process.env.API_KEY : '';
  } catch (e) {
    return '';
  }
})();

// --- MODEL FALLBACK LISTS (Priority High -> Low) ---
const TEXT_MODELS_FALLBACK = [
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

const TTS_MODELS_FALLBACK = [
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-flash"
];

// --- VALID GEMINI VOICES ---
const VALID_VOICE_NAMES = [
  "achernar", "achird", "algenib", "algieba", "alnilam", "aoede", "autonoe", 
  "callirrhoe", "charon", "despina", "enceladus", "erinome", "fenrir", "gacrux", 
  "iapetus", "kore", "laomedeia", "leda", "orus", "puck", "pulcherrima", 
  "rasalgethi", "sadachbia", "sadaltager", "schedar", "sulafat", "umbriel", 
  "vindemiatrix", "zephyr", "zubenelgenubi"
];

// Singleton AudioContext - Lazy Initialization
let audioContextInstance: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioContextInstance || audioContextInstance.state === 'closed') {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioContextInstance = new AudioContext();
    } catch (e) {
      console.error("AudioContext not supported", e);
      throw new Error("Audio playback is not supported in this browser.");
    }
  }
  
  // Attempt to resume if suspended (browser policy)
  if (audioContextInstance.state === 'suspended') {
    audioContextInstance.resume().catch(err => console.debug("Auto-resume AudioContext:", err));
  }
  
  return audioContextInstance;
}

// Helper to safely stringify objects
function safeStringify(obj: any, space: number = 2): string {
  const cache = new Set();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) return;
      cache.add(value);
    }
    if (value instanceof Node || key.startsWith('_react') || key === 'stateNode' || value instanceof Event) return undefined;
    return value;
  }, space);
}

// Helper to parse API error message nicely
function cleanErrorMessage(error: any): string {
  let msg = error.message || '';
  try {
    const parsed = JSON.parse(msg);
    if (parsed.error && parsed.error.message) msg = parsed.error.message;
  } catch (e) { /* ignore */ }
  
  const lowerMsg = msg.toLowerCase();
  if (lowerMsg.includes('429') || lowerMsg.includes('quota') || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('resource exhausted')) {
    return "Usage limit exceeded. Please check your API keys in settings.";
  }
  if (lowerMsg.includes('503') || lowerMsg.includes('overloaded')) {
    return "AI Service is currently overloaded. Please retry.";
  }
  if (lowerMsg.includes('fetch failed') || lowerMsg.includes('network request failed')) {
    return "Network Error: Could not connect to the AI service or Backend. Check your internet or Colab URL.";
  }
  if (lowerMsg.includes('502') || lowerMsg.includes('504')) {
    return "Gateway Error: The backend (Colab/Ngrok) is unreachable or timing out.";
  }
  if (msg.length > 200) return msg.substring(0, 200) + "...";
  return msg;
}

// --- UNIFIED AI GENERATION WITH FALLBACK ---
interface GenerationOptions {
  systemPrompt?: string;
  jsonMode?: boolean;
  retries?: number;
  model?: string;
}

// Core function to handle Model Fallback
async function callGeminiWithFallback(
  userContent: any,
  apiKey: string,
  options: GenerationOptions = {}
): Promise<string> {
  if (!apiKey) throw new Error("Gemini API Key is missing.");
  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  const config: any = {
    temperature: 0.7,
  };
  
  if (options.systemPrompt) {
    config.systemInstruction = options.systemPrompt;
  }
  
  if (options.jsonMode) {
    config.responseMimeType = "application/json";
  }
  
  // Wrap contents properly
  const contents = typeof userContent === 'string'
    ? [{ parts: [{ text: userContent }] }]
    : [{ parts: userContent }];
  
  // Models to try in order
  const modelsToTry = options.model ? [options.model] : TEXT_MODELS_FALLBACK;
  let lastError: any = null;
  
  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: config
      });
      return response.text || "";
    } catch (error: any) {
      console.warn(`[Gemini] ${model} failed.`, error);
      lastError = error;
      if (error.message?.includes("API key")) throw error;
    }
  }
  
  throw new Error(cleanErrorMessage(lastError || new Error("All Gemini models failed.")));
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// --- LOCAL LLM SERVICE (Ngrok/OpenAI Compatible) ---
async function callLocalLlm(messages: ChatMessage[], baseUrl: string): Promise<string> {
  let url = baseUrl.replace(/\/$/, '');
  if (!url.includes('/v1')) url += '/v1';
  if (!url.endsWith('/chat/completions')) url += '/chat/completions';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'
    },
    body: JSON.stringify({
      model: "local-model",
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048
    })
  });
  
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Local LLM Error: ${response.status} - ${txt.substring(0, 100)}`);
  }
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// --- PERPLEXITY SERVICE ---
async function callPerplexityChat(messages: ChatMessage[], apiKey: string): Promise<string> {
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: messages,
      temperature: 0.7
    })
  };
  
  const response = await fetch('https://api.perplexity.ai/chat/completions', options);
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API Error: ${response.status} - ${err}`);
  }
  
  const data = await response.json();
  return data.choices[0]?.message?.content || "";
}

// --- UNIFIED GENERATION DISPATCHER ---
export const generateText = async (
  systemPrompt: string,
  userPrompt: string,
  settings: GenerationSettings,
  jsonMode: boolean = false
): Promise<string> => {
  const provider = settings.helperProvider || 'GEMINI';
  
  try {
    if (provider === 'LOCAL' && settings.localLlmUrl) {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt + (jsonMode ? "\n\nIMPORTANT: Return ONLY valid JSON." : "") },
        { role: "user", content: userPrompt }
      ];
      return await callLocalLlm(messages, settings.localLlmUrl);
    }
    
    if (provider === 'PERPLEXITY' && settings.perplexityApiKey) {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ];
      return await callPerplexityChat(messages, settings.perplexityApiKey);
    }
    
    // Fallback to Gemini (Default)
    const geminiKey = settings.geminiApiKey || SYSTEM_API_KEY;
    return await callGeminiWithFallback(userPrompt, geminiKey, { systemPrompt, jsonMode });
    
  } catch (e: any) {
    if (provider !== 'GEMINI' && SYSTEM_API_KEY) {
      console.log("Falling back to System Gemini...");
      return await callGeminiWithFallback(userPrompt, SYSTEM_API_KEY, { systemPrompt, jsonMode });
    }
    throw new Error(cleanErrorMessage(e));
  }
};

// --- NOVEL LOCALIZATION SERVICE ---
export const localizeNovel = async (
  text: string, 
  targetLang: string, 
  targetCulture: string,
  adaptationMode: 'translate' | 'adapt',
  settings: GenerationSettings
): Promise<string> => {
  const isAdapt = adaptationMode === 'adapt';
  
  const systemPrompt = `You are an expert Literary Translator and Cultural Adapter.
  
  TASK:
  ${isAdapt ? 'Culturally Adapt' : 'Translate'} the input novel/story into ${targetLang}.
  Target Culture/Setting: ${targetCulture}

  RULES:
  1. **Language**: Output must be in ${targetLang}.
  ${isAdapt ? `2. **Names**: Change character names to match the ${targetCulture} ethnicity/region (e.g., 'Jack' -> 'Arjun', 'Sarah' -> 'Priya').
  3. **Places**: Change locations to ${targetCulture} equivalents (e.g., 'New York' -> 'Mumbai', 'London' -> 'Delhi').
  4. **Context**: Adapt food, currency, idioms, and weather to fit ${targetCulture}.
  5. **Plot**: Keep the core plot events, emotional beats, and dialogue structure IDENTICAL. Just re-skin the world.` 
  : `2. **Names/Places**: Keep original names and places. Do not change them.
  3. **Context**: Maintain original cultural context.`}
  
  Output ONLY the adapted story text. No explanations.`;

  const userPrompt = `Story to Adapt:\n"${text}"`;

  try {
     return await generateText(systemPrompt, userPrompt, settings, false);
  } catch (e: any) {
     throw new Error(cleanErrorMessage(e));
  }
};

// Helper to extract JSON from LLM response
function extractJSON(text: string): any {
  try {
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const jsonStr = cleanText.substring(start, end + 1);
      return JSON.parse(jsonStr);
    }
  } catch (e) {
    console.warn("JSON Extraction failed", e);
  }
  return null;
}

// Helper to decode base64
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper for raw PCM
function pcm16ToAudioBuffer(
  int16Data: Int16Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number
): AudioBuffer {
  if (int16Data.length === 0) {
    return ctx.createBuffer(1, sampleRate, sampleRate);
  }
  
  const frameCount = int16Data.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = int16Data[i * numChannels + channel] / 32768.0;
    }
  }
  
  return buffer;
}

// Helper to fetch audio from URL and decode
export async function fetchAudioBuffer(url: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } catch (e: any) {
    throw new Error(`Audio Fetch Error: ${e.message}`);
  }
}

// Helper to concatenate AudioBuffers
function concatenateAudioBuffers(ctx: AudioContext, buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 0) return ctx.createBuffer(1, 1, 24000);
  
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  const result = ctx.createBuffer(buffers[0].numberOfChannels, totalLength, buffers[0].sampleRate);
  
  let offset = 0;
  for (const buf of buffers) {
    for (let i = 0; i < result.numberOfChannels; i++) {
      if (i < buf.numberOfChannels) {
        result.getChannelData(i).set(buf.getChannelData(i), offset);
      } else {
        result.getChannelData(i).set(buf.getChannelData(0), offset);
      }
    }
    offset += buf.length;
  }
  
  return result;
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;
  
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  let offset = 0;
  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, 36 + dataLength, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, format, true); offset += 2;
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bitDepth, true); offset += 2;
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataLength, true); offset += 4;
  
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = buffer.getChannelData(channel)[i];
      const clamped = Math.max(-1, Math.min(1, sample));
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export const extractAudioFromVideo = async (videoFile: File): Promise<Blob> => {
  const ctx = getAudioContext();
  const arrayBuffer = await videoFile.arrayBuffer();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return audioBufferToWav(audioBuffer);
  } catch (e) {
    throw new Error("Failed to decode audio. Codec might not be supported.");
  }
};

// --- GENDER DETECTION HEURISTICS ---
// Common indicators for gender guessing when AI isn't available
const MALE_INDICATORS = ['mr', 'lord', 'king', 'sir', 'father', 'dad', 'uncle', 'brother', 'boy', 'man', 'he', 'him', 'his', 'john', 'david', 'michael', 'james', 'robert', 'william', 'joseph', 'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian', 'george', 'edward', 'ronald', 'timothy', 'jason', 'jeffrey', 'ryan', 'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin', 'samuel', 'gregory', 'frank', 'alexander', 'raymond', 'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'henry', 'nathan', 'douglas', 'zachary', 'peter', 'kyle', 'walter', 'ethan', 'jeremy', 'harold', 'keith', 'christian', 'roger', 'noah', 'gerald', 'terry', 'sean', 'austin', 'carl', 'arthur', 'lawrence', 'dylan', 'jesse', 'jordan', 'bryan', 'billy', 'joe', 'bruce', 'gabriel', 'logan', 'albert', 'willie', 'alan', 'juan', 'wayne', 'elijah', 'randy', 'roy', 'vincent', 'ralph', 'eugene', 'russell', 'bobby', 'mason', 'philip', 'louis', 'detective', 'officer', 'sergeant', 'captain', 'commander', 'chief', 'boss', 'guard', 'soldier'];
const FEMALE_INDICATORS = ['mrs', 'ms', 'miss', 'lady', 'queen', 'madam', 'mother', 'mom', 'aunt', 'sister', 'girl', 'woman', 'she', 'her', 'hers', 'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen', 'nancy', 'lisa', 'betty', 'margaret', 'sandra', 'ashley', 'kimberly', 'emily', 'donna', 'michelle', 'dorothy', 'carol', 'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia', 'kathleen', 'amy', 'shirley', 'angela', 'helen', 'anna', 'brenda', 'pamela', 'nicole', 'samantha', 'katherine', 'emma', 'ruth', 'christine', 'catherine', 'debra', 'rachel', 'carolyn', 'janet', 'virginia', 'maria', 'heather', 'diane', 'julie', 'joyce', 'evelyn', 'joan', 'victoria', 'kelly', 'christina', 'lauren', 'frances', 'martha', 'judith', 'cheryl', 'megan', 'andrea', 'olivia', 'ann', 'alice', 'jean', 'doris', 'jacqueline', 'kathryn', 'hannah', 'julia', 'gloria', 'teresa', 'velma', 'sara', 'janice', 'phyllis', 'marie', 'julia', 'grace', 'judy', 'theresa', 'madison', 'beverly', 'denise', 'marilyn', 'amber', 'danielle', 'rose', 'brittany', 'diana', 'abigail', 'natalie', 'jane', 'lori', 'alexis', 'tiffany', 'kayla', 'witch', 'princess', 'bride', 'nurse', 'waitress', 'actress'];

export function guessGenderFromName(name: string): 'Male' | 'Female' | 'Unknown' {
  const n = name.toLowerCase().trim();
  const parts = n.split(' ');
  
  // Check full name parts
  for (const part of parts) {
    if (MALE_INDICATORS.includes(part)) return 'Male';
    if (FEMALE_INDICATORS.includes(part)) return 'Female';
  }
  
  // Suffix checks (rough heuristics for English)
  if (n.endsWith('a') || n.endsWith('ie') || n.endsWith('elle') || n.endsWith('i') || n.endsWith('enne') || n.endsWith('ine')) return 'Female';
  if (n.endsWith('o') || n.endsWith('us') || n.endsWith('er') || n.endsWith('or') || n.endsWith('son') || n.endsWith('an')) return 'Male';
  
  return 'Unknown';
}

// --- ROBUST REGEX FOR MULTI-SPEAKER & SFX ---
// Updated to handle "Name:", "Name (Emotion):", "**Name**:", and loose colon placement
export const SPEAKER_REGEX = /^(?:\[.*?\])?\s*(\*+)?([A-Z][a-zA-Z0-9\s\._-]{1,25}?)(?:\s*[\(\[]([^)\]]{1,25})[\)\]])?(\*+)?\s*[:：]\s*(.*)$/s;
export const SFX_REGEX = /^(?:\[|\()(?:SFX|sfx|Sound|SOUND|Music|MUSIC)[:：\s]?\s*([^\]\)]+)(?:\]|\))/i;

export function parseMultiSpeakerScript(text: string) {
  const lines = text.split('\n');
  const uniqueSpeakers = new Set<string>();
  
  const IGNORE_LIST = [
    'chapter', 'scene', 'part', 'note', 'end', 'sfx',
    'narrator', 'unknown', 'start', 'recap', 'prologue',
    'epilogue', 'act', 'time', 'location', 'title', 'intro',
    'outro', 'credits', 'the', 'background', 'camera', 'fade'
  ];
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 2) return;
    if (SFX_REGEX.test(trimmed)) return;
    
    // Check main regex
    const match = trimmed.match(SPEAKER_REGEX);
    if (match && match[2]) {
      let name = match[2].trim().replace(/[\*\[\]]/g, '');
      const lower = name.toLowerCase();
      
      // Validation Logic
      if (name.length > 0 && name.length < 40 &&
          !IGNORE_LIST.some(ignore => lower.startsWith(ignore)) &&
          isNaN(Number(name)) && // Not just a number
          name.split(' ').length <= 5 // Max 5 words in a name
      ) {
        uniqueSpeakers.add(name);
      }
    }
  });
  
  const speakersList = Array.from(uniqueSpeakers);
  return { isMultiSpeaker: speakersList.length > 0, speakersList };
}

export const parseStudioDialogue = (text: string): { speaker?: string, text: string, isSfx?: boolean, emotion?: string }[] => {
  const lines = text.split('\n');
  const segments: { speaker?: string, text: string, isSfx?: boolean, emotion?: string }[] = [];
  
  let currentSpeaker = 'Narrator';
  let currentEmotion: string | undefined = undefined;
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    // Check for SFX first
    const sfxMatch = trimmed.match(SFX_REGEX);
    if (sfxMatch) {
      segments.push({ speaker: 'SFX', text: sfxMatch[1].trim(), isSfx: true });
      return;
    }
    
    // Check for speaker dialogue
    const match = trimmed.match(SPEAKER_REGEX);
    if (match) {
      // New speaker line
      const newSpeaker = match[2]?.trim().replace(/[\*\[\]]/g, '') || 'Unknown';
      const newEmotion = match[3]?.trim() || undefined;
      const dialogue = match[5]?.trim() || '';
      
      currentSpeaker = newSpeaker;
      currentEmotion = newEmotion;
      
      if (dialogue) {
        segments.push({ speaker: currentSpeaker, text: dialogue, emotion: currentEmotion });
      }
    } else {
      // Continuation line or Narrator line?
      // Heuristic: if it looks like narration (starts with parens or is descriptive), use Narrator
      // Otherwise append to current speaker if detected recently
      
      // If the line is short and wrapped in parens, it's likely a direction or narration
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
          segments.push({ speaker: 'Narrator', text: trimmed, emotion: 'Neutral' });
      } else {
          // Assume continuation of previous speaker
          segments.push({ speaker: currentSpeaker, text: trimmed, emotion: currentEmotion });
      }
    }
  });
  
  return segments;
};

export const parseScriptToSegments = (text: string): { startTime: number; speaker: string; text: string; emotion?: string }[] => {
  const lines = text.split('\n');
  const segments: { startTime: number; speaker: string; text: string; emotion?: string }[] = [];
  
  const timeToSeconds = (timestamp: string) => {
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  };
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    // Look for timestamp at start (00:00) Name: Text
    const match = trimmed.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:([A-Za-z\s]+)[:：])?\s*(.*)/);
    
    if (match && match[1]) { 
      segments.push({
        startTime: timeToSeconds(match[1]),
        speaker: match[2]?.trim() || 'Speaker',
        text: match[3]?.trim() || '',
        emotion: 'Neutral'
      });
    }
  });
  
  return segments;
};

// --- AI DIRECTOR SERVICES ---
export const autoCorrectText = async (text: string, settings: GenerationSettings): Promise<string> => {
  const systemPrompt = `You are an expert Audio Script Editor.
Transform the input text into a production-ready Audio Script.

RULES:
1. EVERY line must start with "Speaker Name (Emotion): ".
2. Use "Narrator (Neutral): " for descriptive text.
3. Fix grammar/spelling.
4. Preserve original meaning and structure.

Output ONLY the script with NO additional commentary.`;
  
  const userPrompt = `Format this text:\n"${text}"`;
  
  try {
    const result = await generateText(systemPrompt, userPrompt, settings, false);
    return result.replace(/^Here is the.*?:\s*/i, '').trim();
  } catch (e: any) {
    throw new Error(cleanErrorMessage(e));
  }
};

export const proofreadScript = async (
  text: string, 
  settings: GenerationSettings,
  mode: 'grammar' | 'flow' | 'creative' | 'novel' = 'flow'
): Promise<string> => {
  const provider = settings.helperProvider || 'GEMINI';
  
  let systemPrompt = `You are an Expert Audio Script Editor and Proofreader.
Your goal is to prepare text for Ultra-Realistic Text-to-Speech synthesis.

MODES:
1. GRAMMAR: Fix spelling, punctuation, and capitalization errors only. Keep phrasing exact.
2. FLOW (Default): Fix grammar AND improve sentence rhythm for natural speech. Use contractions (it is -> it's). Add commas for breathing pauses.
3. CREATIVE: Enhance vocabulary and emotion. Make dialogue punchy, dramatic, and natural.

CRITICAL RULES for REALISM:
1. NEVER remove or alter "Speaker Name:" or "(Emotion)" tags.
2. Convert difficult symbols to spoken text (e.g., "%" -> "percent", "&" -> "and").
3. Keep timestamps [00:00] intact if present.
4. Expand numbers to text (e.g., "1995" -> "nineteen ninety-five", "$50" -> "fifty dollars").
5. Add pauses explicitly using commas or ellipses (...) where a speaker would naturally breathe.
6. Use phonetic spelling for difficult names if possible (e.g., "Siobhan" -> "Shi-vawn") in parenthesis or just fix spacing.

Output ONLY the corrected text. Do not add "Here is the corrected version".`;

  if (mode === 'novel') {
      systemPrompt = `You are a World-Class Audio Drama Director and Novelist.
      
      GOAL: Transform the input text into an immersive "Audio Novel" script.
      
      INSTRUCTIONS:
      1. **Unified Advanced Flow**: Merge creative writing with natural speech rhythm.
      2. **Advanced Emotions**: Explicitly add rich emotion tags like (Laughing), (Sarcastic), (Taunting), (Whispering), (Gasping), (Mimicking) inside the speaker tag.
      3. **Sound Effects**: Detect context and insert [SFX: Sound Description] tags where appropriate (e.g. footsteps, door slams, rain).
      4. **Hinglish Support**: If the text seems to be in an Indian context, ensure "Hinglish" (Hindi + English) phrasing is natural and urban.
      5. **Narrative to Dialogue**: If prose is too dense, break it into "Narrator (Neutral):" lines or convert to character dialogue.
      6. **Pacing**: Use ellipses (...) for suspense and hesitation.
      
      EXAMPLE OUTPUT:
      [SFX: Rain tapping on window]
      Rahul (Sighing): Yaar, I don't know what to do anymore.
      Priya (Taunting): Oh really? Ab yaad aaya?
      [SFX: Thunder clap]
      Narrator (Neutral): The lights flickered and died.
      
      Output ONLY the script.
      `;
  }

  const userPrompt = `Mode: ${mode.toUpperCase()}\n\nText to Proofread:\n"${text}"`;

  try {
    const result = await generateText(systemPrompt, userPrompt, settings, false);
    return result.replace(/^Here is.*?:\s*/i, '').trim();
  } catch (e: any) {
    throw new Error(cleanErrorMessage(e));
  }
};

export interface DirectorOptions {
  style: 'lip_sync' | 'natural' | 'summary';
  tone: 'neutral' | 'dramatic' | 'funny' | 'professional' | 'hype';
}

export const autoFormatScript = async (
  text: string,
  settings: GenerationSettings,
  mode: 'audio_drama' | 'video_dub' = 'audio_drama',
  options?: DirectorOptions,
  existingCharacters: CharacterProfile[] = []
): Promise<{
  formattedText: string,
  cast: {
    name: string,
    gender: 'Male' | 'Female' | 'Unknown',
    age?: 'Child' | 'Young Adult' | 'Adult' | 'Elderly'
  }[],
  mood?: string,
  suggestedMusicTrackId?: string
}> => {
  const castContext = existingCharacters.length > 0
    ? `**EXISTING CAST:** ${existingCharacters.map(c => `${c.name} (${c.gender})`).join(', ')}. Reuse these if applicable.`
    : "Detect characters.";
  
  const systemPrompt = `You are a World-Class Audio Drama Director.
Transform input text into a strict audio script format.

${castContext}

**TASK:**
1. Identify speakers. Detect Gender (Male/Female) and Age (Child/Young Adult/Adult/Elderly).
2. Convert prose to dialogue format: "Character (Emotion): Dialogue".
3. **ADVANCED EMOTIONS**: Use specific tags in parenthesis. Examples: (Laughing), (Taunting), (Mimicking), (Sarcastic), (Crying), (Whispering), (Shouting).
4. Use "Narrator (Neutral): " for narration.
5. Preserve capitalization for character names.

**Output JSON Schema:**
{
  "cast": [
    { "name": "string", "gender": "Male|Female|Unknown", "age": "string" }
  ],
  "script": "string (The full formatted script text. NO MARKDOWN.)",
  "mood": "string"
}

IMPORTANT: Return ONLY valid JSON with NO additional text.`;
  
  const userPrompt = `Direct this text:\n"${text.substring(0, 50000)}"`;
  
  try {
    const resultText = await generateText(systemPrompt, userPrompt, settings, true);
    const json = extractJSON(resultText);
    
    if (!json || !json.script) {
      return { formattedText: text, cast: [] };
    }
    
    return {
      formattedText: json.script || text,
      cast: json.cast || [],
      mood: json.mood,
    };
  } catch (e: any) {
    throw new Error(cleanErrorMessage(e));
  }
};

// --- DETECTION SERVICES ---
export const detectLanguage = async (text: string, settings: GenerationSettings): Promise<string> => {
  if (!text || text.trim().length < 3) return 'en';
  if (/\b(kya|kyu|kaise|main|tum|aap|hai|hain|tha)\b/i.test(text)) return 'hi-latn';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u3040-\u309f]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  return 'en';
};

export const generateTextContent = async (prompt: string, currentText: string | undefined, settings: GenerationSettings): Promise<string> => {
  const systemPrompt = "You are a creative writing assistant. Output ONLY the requested text with NO additional commentary.";
  const userPrompt = currentText ? `Original Text: "${currentText}"\n\nTask: ${prompt}` : `Task: ${prompt}`;
  return await generateText(systemPrompt, userPrompt, settings, false);
};

export const translateText = async (text: string, targetLanguage: string, settings: GenerationSettings): Promise<string> => {
  let promptLang = targetLanguage;
  
  let additionalInstruction = "";

  if (targetLanguage === 'Hinglish') {
    promptLang = "Hinglish (Urban Indian English)";
    additionalInstruction = `
    SPECIFIC INSTRUCTIONS FOR HINGLISH:
    1. Code-mix Hindi and English naturally (like urban Indians speak).
    2. Use English for nouns, technical terms, and impactful adjectives (e.g. "Problem create mat karo", "Situation intense hai").
    3. Use Hindi (Roman script) for grammar, connective words, and core emotions.
    4. Keep it conversational and informal where appropriate.
    5. STRICTLY use Roman characters (Latin script). No Devanagari.
    `;
  }
  
  // Check if it looks like a script with timestamps
  const isScript = /^(?:\s*[\[\(]?(\d{1,2}:\d{2}))/m.test(text);
  
  let systemPrompt = `Translate the following text to ${promptLang}. ${additionalInstruction}`;
  
  if (isScript) {
    systemPrompt += `

IMPORTANT RULES:
1. Preserve all timestamps format like (00:00) EXACTLY.
2. Preserve Speaker names and Emotions in parenthesis.
3. Only translate the dialogue text.
4. Maintain the original line structure.
`;
  } else {
    systemPrompt += ` Preserve "Speaker: " format if present.`;
  }
  
  return await generateText(systemPrompt, text, settings, false);
};

export const translateVideoContent = async (videoFile: File, targetLanguage: string, settings: GenerationSettings): Promise<string> => {
  const audioBlob = await extractAudioFromVideo(videoFile);
  const geminiKey = settings.geminiApiKey || SYSTEM_API_KEY;
  if (!geminiKey) throw new Error("API Key missing");
  
  const buffer = await audioBlob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunkSize, len))));
  }
  
  const base64Audio = btoa(binary);
  
  let userPrompt = "";
  if (targetLanguage === 'Original' || targetLanguage === 'Auto' || !targetLanguage) {
    userPrompt = `Transcribe the audio verbatim in its original language.
Format EXACTLY as: (MM:SS) Speaker (Emotion): Dialogue.
Identify speakers by name if possible, otherwise use Speaker 1, Speaker 2.`;
  } else {
    userPrompt = `Transcribe the audio and translate it to ${targetLanguage}.
Format EXACTLY as: (MM:SS) Speaker (Emotion): Dialogue.
Preserve the original timing (timestamps) accurately.`;
  }
  
  const contentParts = [
    { inlineData: { mimeType: "audio/wav", data: base64Audio } },
    { text: userPrompt }
  ];
  
  try {
    return await callGeminiWithFallback(contentParts, geminiKey);
  } catch (e: any) {
    throw new Error(`Video translation failed: ${cleanErrorMessage(e)}`);
  }
};

export const analyzeVoiceSample = async (audioBlob: Blob, settings: GenerationSettings): Promise<string> => {
  const geminiKey = settings.geminiApiKey || SYSTEM_API_KEY;
  if (!geminiKey) return "Analyzed Voice Profile";
  return "Custom Voice Clone";
};

// --- FETCH REMOTE SPEAKERS ---
export const fetchRemoteSpeakers = async (backendUrl: string): Promise<RemoteSpeaker[]> => {
  if (!backendUrl) return [];
  
  let url = backendUrl.replace(/\/$/, '');
  if (!url.endsWith('/speakers')) url += '/speakers';
  
  try {
    const res = await fetch(url, {
      headers: { 'ngrok-skip-browser-warning': 'true', 'Accept': 'application/json' }
    });
    
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
      throw new Error("Endpoint returned HTML. Check Ngrok URL.");
    }
    
    if (!res.ok) throw new Error(`Status ${res.status}`);
    
    const data = await res.json();
    
    if (Array.isArray(data)) {
      if (data.length === 0) return [];
      if (typeof data[0] === 'string') return data.map((s: string) => ({ id: s, name: s }));
      if (data[0].id) return data.map((s: any) => ({ id: String(s.id), name: s.name }));
    }
    else if (data.speakers && Array.isArray(data.speakers)) {
      const speakers = data.speakers;
      if (typeof speakers[0] === 'string') return speakers.map((s: string) => ({ id: s, name: s }));
      return speakers;
    }
    
    return [];
  } catch (e) {
    console.warn("Failed to fetch remote speakers:", e);
    throw e;
  }
};

// Helper to fetch clone audio data as base64
async function getCloneBase64(sampleUrl: string): Promise<string | null> {
  try {
    const res = await fetch(sampleUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch(e) {
    console.warn("Clone base64 failed:", e);
    return null;
  }
}

// --- TTS SERVICE (FIXED LOGIC) ---
export const generateSpeech = async (
  text: string,
  voiceName: string,
  settings: GenerationSettings,
  mode: 'speech' | 'singing' = 'speech',
  signal?: AbortSignal
): Promise<AudioBuffer> => {
  const ctx = getAudioContext();
  
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!text || text.trim().length === 0) throw new Error("Input text is empty.");
  
  // Determine language
  let lang = 'en';
  if (settings.language && settings.language !== 'Auto') {
    const langObj = LANGUAGES.find(l => l.name === settings.language);
    lang = langObj ? langObj.code.substring(0, 2) : 'en';
  }
  
  // Clean text helper (removes metadata)
  const cleanText = (rawText: string) => {
    // Attempt to extract dialogue if it matches script format
    const match = rawText.match(SPEAKER_REGEX);
    if (match && match[5]) {
        return match[5].trim();
    }
    // Otherwise just clean timestamps and bracketed info
    return rawText
      .replace(/(?:[\[\(]?\d{1,2}:\d{2}(?::\d{2})?[\]\)]?)/g, '')
      .replace(/\[.*?\]/g, '') // remove brackets
      .trim();
  };
  
  // Load cloned voices
  let availableClones: ClonedVoice[] = [];
  try { 
    availableClones = JSON.parse(localStorage.getItem('vf_clones') || '[]'); 
  } catch (e) {}
  
  // Parse for multi-speaker & SFX
  const studioSegments = parseStudioDialogue(text);
  const hasSfx = studioSegments.some(s => s.isSfx);
  const { isMultiSpeaker, speakersList } = parseMultiSpeakerScript(text);
  
  // Use segmented generation if: SFX present, multi-speaker, or Coqui/OpenAI engine
  // Or simply always use it for Studio mode to ensure consistency
  const useSegmentedGeneration = hasSfx || (isMultiSpeaker && speakersList.length > 0) || settings.engine === 'COQ' || settings.engine === 'OPENAI' || settings.engine === 'F5' || settings.engine === 'LOCAL_WEBGPU' || studioSegments.length > 1;
  
  // --- BATCH PROCESSING FOR MULTI-SPEAKER ---
  if (useSegmentedGeneration) {
    const validSegments = studioSegments
      .map((s, i) => ({ ...s, originalIndex: i }))
      .filter(s => s.text.trim() || s.isSfx);
    
    const segmentResults: { index: number, buffer: AudioBuffer }[] = [];
    const BATCH_SIZE = 2; // Keep small for reliability
    
    for (let i = 0; i < validSegments.length; i += BATCH_SIZE) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      
      const batch = validSegments.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (seg) => {
        if (signal?.aborted) return;
        
        try {
          // Handle SFX
          if (seg.isSfx) {
            const sfxItem = SFX_LIBRARY.find(s => 
              s.name.toLowerCase() === seg.text.toLowerCase() || 
              s.id === seg.text
            );
            
            if (sfxItem) {
              const buffer = await fetchAudioBuffer(sfxItem.url);
              segmentResults.push({ index: seg.originalIndex, buffer });
            } else {
              // Silent buffer if SFX missing
              segmentResults.push({ 
                index: seg.originalIndex, 
                buffer: ctx.createBuffer(1, 24000, 24000) 
              });
            }
            return;
          }
          
          // Determine effective voice for this segment
          let effectiveVoiceId = settings.voiceId || voiceName;
          let effectiveVoiceName = voiceName;
          let effectiveSpeed = settings.speed;
          
          if (seg.speaker) {
            if (settings.speakerMapping && settings.speakerMapping[seg.speaker]) {
               const mappedId = settings.speakerMapping[seg.speaker];
               effectiveVoiceId = mappedId;
               
               if (settings.engine === 'COQ' || settings.engine === 'OPENAI' || settings.engine === 'F5' || settings.engine === 'LOCAL_WEBGPU') {
                   effectiveVoiceName = mappedId;
               } else {
                   const v = VOICES.find(x => x.id === mappedId) || availableClones.find(x => x.id === mappedId);
                   if (v) {
                       effectiveVoiceName = v.geminiVoiceName || v.name;
                   } else {
                       effectiveVoiceName = 'Fenrir';
                   }
               }
            } else {
               // SMART FALLBACK: Auto-Assign Voice based on Gender Heuristic
               // If no mapping exists, we don't just want default 'Fenrir'. 
               // We want to consistently pick a Male/Female voice based on name.
               
               const detectedGender = guessGenderFromName(seg.speaker);
               
               // Select Candidate Pool based on Engine
               let candidates: any[] = [];
               if (settings.engine === 'OPENAI') candidates = OPENAI_VOICES;
               else if (settings.engine === 'F5') candidates = F5_VOICES;
               else candidates = VOICES; // Gemini & WebGPU

               // Filter by gender if known, otherwise use all
               let genderCandidates = candidates.filter(v => v.gender === detectedGender);
               if (genderCandidates.length === 0) genderCandidates = candidates;
               
               // Hash the name to consistently pick the same voice for the same name
               let hash = 0;
               for (let c = 0; c < seg.speaker.length; c++) hash = seg.speaker.charCodeAt(c) + ((hash << 5) - hash);
               const idx = Math.abs(hash) % genderCandidates.length;
               
               const selectedVoice = genderCandidates[idx];
               if (selectedVoice) {
                   effectiveVoiceId = selectedVoice.id;
                   if (settings.engine === 'GEM') effectiveVoiceName = selectedVoice.geminiVoiceName;
                   else if (settings.engine === 'COQ') effectiveVoiceName = selectedVoice.id; 
                   else effectiveVoiceName = selectedVoice.id; // OpenAI / F5 / WebGPU usually use ID
               }
            }
          }
          
          // Inject Emotion into text for models that support context
          // For Gemini 2.5, we prepend the emotion/tone to the text if it's significant
          let textToGen = seg.text;
          if (seg.emotion && seg.emotion !== 'Neutral' && settings.engine === 'GEM') {
               textToGen = `(Tone: ${seg.emotion}) ${seg.text}`;
          }
          
          // Create segment-specific settings
          const segSettings = { 
            ...settings, 
            chatterboxId: effectiveVoiceId, 
            voiceId: effectiveVoiceId,
            emotion: seg.emotion || settings.emotion || 'Neutral',
            speed: effectiveSpeed
          };
          
          // Recursively generate speech for this segment
          const buf = await generateSpeech(
            textToGen, 
            effectiveVoiceName, 
            segSettings, 
            mode, 
            signal
          );
          
          segmentResults.push({ index: seg.originalIndex, buffer: buf });
          
        } catch (e: any) {
          if (e.name === 'AbortError') throw e;
          
          console.warn(`Failed segment "${seg.text.substring(0,15)}":`, e);
          
          // Push silent buffer to maintain sync
          const estimatedDuration = Math.max(1, seg.text.length / 15);
          segmentResults.push({ 
            index: seg.originalIndex, 
            buffer: ctx.createBuffer(1, Math.ceil(estimatedDuration * 24000), 24000) 
          });
        }
      }));
    }
    
    // Sort and concatenate
    segmentResults.sort((a, b) => a.index - b.index);
    return concatenateAudioBuffers(ctx, segmentResults.map(s => s.buffer));
  }

  // --- LOCAL WEBGPU (INBUILT F5/TRANSFORMERS) ENGINE ---
  if (settings.engine === 'LOCAL_WEBGPU') {
    try {
      // Use the F5/Onnx service worker
      const processedText = cleanText(text);
      // Signal loading state to UI if possible via a callback?
      // For now we trust the service to handle init
      return await f5OnnxEngine.generate(processedText);
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      console.error("Local WebGPU Generation failed:", err);
      throw new Error(`On-Device Generation Error: ${err.message || err}`);
    }
  }

  // --- F5-TTS ENGINE (BACKEND) ---
  if (settings.engine === 'F5') {
      if (!settings.backendUrl) throw new Error("Backend URL is required for F5-TTS.");
      
      try {
          let url = settings.backendUrl.replace(/\/$/, '');
          // Standard OpenAI-like endpoint wrapper often used for F5 deployments
          if (!url.includes('/v1/audio/speech')) url += '/v1/audio/speech';

          // Determine the voice
          let targetVoiceId = voiceName || settings.voiceId;
          let voicePayload: any = targetVoiceId;

          // F5 Optimization: Check if it is a cloned voice
          const isClone = availableClones.find(v => v.id === targetVoiceId);
          
          if (isClone && isClone.originalSampleUrl) {
             // Convert sample to base64 to support "Max Features" (Cloning)
             const base64Ref = await getCloneBase64(isClone.originalSampleUrl);
             if (base64Ref) {
                 // HACK: Some API wrappers allow passing base64 as voice name, 
                 // or we might need to adjust depending on the specific wrapper.
                 // Assuming standard "openedai-speech" behavior or compatible fork.
                 voicePayload = `base64:${base64Ref}`;
                 console.log("F5: Sending base64 clone data for voice", targetVoiceId);
             }
          } else {
              // Map default presets
              if (!F5_VOICES.find(v => v.id === targetVoiceId)) {
                   // If user selects a Gemini voice, map to a default F5 voice
                   const geminiVoice = VOICES.find(v => v.id === targetVoiceId);
                   voicePayload = (geminiVoice?.gender === 'Female') ? 'f5_female' : 'f5_male';
              }
          }

          // F5 is sensitive to punctuation, do NOT strip it aggressively
          let processedText = cleanText(text); 
          if (!processedText) throw new Error("Input text is empty");

          // Request Body
          const body = {
              model: settings.f5Model || 'f5-tts',
              input: processedText,
              voice: voicePayload,
              speed: settings.speed || 1.0,
              response_format: 'pcm', // Request raw PCM if supported for optimization
          };

          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer sk-dummy-key',
              'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(body),
            signal: signal
          });

          if (!res.ok) {
             const errorText = await res.text();
             throw new Error(`F5 Backend Error ${res.status}: ${errorText.substring(0, 100)}`);
          }

          const arrayBuffer = await res.arrayBuffer();
          if (arrayBuffer.byteLength < 100) throw new Error("Empty audio response from F5");

          // Optimization: WebGPU / AudioWorklet style processing
          // If backend returned raw PCM (optimal) vs MP3/WAV
          if (settings.enableWebGpu && arrayBuffer.byteLength % 2 === 0) {
               // Assume raw PCM 16-bit 24khz/44.1khz if 'enableWebGpu' flag is effectively 'Enable Raw PCM'
               const int16 = new Int16Array(arrayBuffer);
               // F5 usually defaults to 24000 or 44100. We guess 24000 for speech models.
               return pcm16ToAudioBuffer(int16, ctx, 24000, 1);
          }

          // Standard Decoding (WAV/MP3)
          return await ctx.decodeAudioData(arrayBuffer);

      } catch (err: any) {
          if (err.name === 'AbortError') throw err;
          console.error("F5-TTS failed:", err);
          throw err;
      }
  }
  
  // --- OPENAI COMPATIBLE ENGINE ---
  if (settings.engine === 'OPENAI') {
    if (!settings.backendUrl) throw new Error("Backend URL is required for OpenAI/Local engine.");
    
    try {
      let url = settings.backendUrl.replace(/\/$/, '');
      if (!url.includes('/v1/audio/speech')) url += '/v1/audio/speech';
      
      const modelName = settings.openaiModel || 'openedai-speech-bilingual-tts-1';
      
      // FIX FOR "KeyError: 'v1'"
      // Ensure we don't send Gemini Voice IDs to OpenAI/Compatible Backend
      let targetVoice = voiceName || settings.voiceId || 'alloy';
      
      // Check if this is a Gemini voice ID (v1-v30)
      const isGeminiVoice = VOICES.some(v => v.id === targetVoice);
      // Check if it's a standard OpenAI voice
      const isOpenAIVoice = OPENAI_VOICES.some(v => v.id === targetVoice);
      
      // If it looks like a Gemini voice and isn't a known OpenAI voice, map it to a safe default
      if (isGeminiVoice && !isOpenAIVoice) {
          const geminiData = VOICES.find(v => v.id === targetVoice);
          // Try to respect gender if possible
          if (geminiData?.gender === 'Male') targetVoice = 'onyx';
          else if (geminiData?.gender === 'Female') targetVoice = 'nova';
          else targetVoice = 'alloy';
      }
      
      let processedText = cleanText(text);
      if (!processedText && text.trim()) processedText = text.trim();
      
      if (!processedText) throw new Error("Input text is empty after processing.");

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-dummy-key', // Dummy key often required by proxies
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          model: modelName,
          input: processedText,
          voice: targetVoice, // Use the corrected voice ID
          speed: settings.speed || 1.0
        }),
        signal: signal
      });

      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("Backend returned HTML (Ngrok Warning Page).");
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Backend Error ${res.status}: ${errorText.substring(0, 100)}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength < 100) throw new Error("Empty audio response.");
      
      return await ctx.decodeAudioData(arrayBuffer);
      
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      console.error("OpenAI backend failed:", err);
      throw err;
    }
  }

  // --- COQUI ENGINE ---
  if (settings.engine === 'COQ') {
    if (!settings.backendUrl) throw new Error("Backend URL is required for Coqui.");
    
    try {
      let url = settings.backendUrl.replace(/\/$/, '');
      if (!url.endsWith('/tts') && !url.endsWith('/api/tts')) url += '/tts';
      
      let speakerId = voiceName;
      
      // If voiceName is a Gemini name (or present in our list of known Gemini voices), 
      // we should prefer the stored Chatterbox ID if available, unless speakerId is explicitly set.
      const isGeminiName = VOICES.some(v => v.geminiVoiceName === voiceName || v.id === voiceName) || VALID_VOICE_NAMES.includes(voiceName.toLowerCase());
      
      if (!speakerId || isGeminiName) {
        speakerId = settings.chatterboxId || settings.voiceId || '';
      }
      
      // Fallback if empty
      if (!speakerId) speakerId = 'p226'; // Default VCTK speaker often present
      
      let processedText = cleanText(text);
      if (!processedText && text.trim()) processedText = text.trim();
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({
          text: processedText,
          speaker_id: speakerId,
          language_id: lang,
          emotion: settings.emotion || 'Neutral'
        }),
        signal: signal
      });
      
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("Backend returned HTML (Ngrok Warning Page).");
      }
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Backend Error ${res.status}: ${errorText.substring(0, 100)}`);
      }
      
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength < 100) throw new Error("Empty audio response.");
      
      try {
        return await ctx.decodeAudioData(arrayBuffer);
      } catch (e) {
        // Check for JSON error
        try {
          const textDec = new TextDecoder().decode(arrayBuffer);
          if (textDec.trim().startsWith('{')) {
            throw new Error(JSON.parse(textDec).detail || "Backend Error");
          }
        } catch(jsonEx) {}
        
        // RAW PCM FALLBACK
        if (arrayBuffer.byteLength % 2 !== 0) throw new Error("Invalid PCM length.");
        const int16 = new Int16Array(arrayBuffer);
        return pcm16ToAudioBuffer(int16, ctx, 24000, 1);
      }
      
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      console.error("Coqui backend failed:", err);
      throw err;
    }
  }
  
  // --- GEMINI TTS ---
  const geminiKey = settings.geminiApiKey || SYSTEM_API_KEY;
  if (!geminiKey) throw new Error("API Key is missing for Gemini TTS.");
  
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  
  try {
    let targetVoice = voiceName;
    
    // Check if voiceName is a Gemini name or mapped ID
    const matchedVoice = VOICES.find(v => v.id === targetVoice);
    if (matchedVoice) targetVoice = matchedVoice.geminiVoiceName;

    // Strict validation: Check if voice is in the allowed list
    const validVoice = VALID_VOICE_NAMES.find(v => v.toLowerCase() === targetVoice.toLowerCase());
    
    if (!validVoice) {
       console.warn(`Voice "${targetVoice}" is not supported. Falling back to Fenrir.`);
       targetVoice = 'Fenrir';
    } else {
       targetVoice = validVoice; // Use the canonical casing
    }
    
    const textToSpeak = cleanText(text);
    
    let lastError: any = null;
    
    for (const model of TTS_MODELS_FALLBACK) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: [{ parts: [{ text: textToSpeak }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { 
              voiceConfig: { 
                prebuiltVoiceConfig: { voiceName: targetVoice } 
              } 
            }
          },
        });
        
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) throw new Error(`No audio from ${model}`);
        
        const audioBytes = decode(base64Audio);
        const int16Data = new Int16Array(audioBytes.buffer);
        
        return pcm16ToAudioBuffer(int16Data, ctx, 24000, 1);
        
      } catch (error: any) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        console.warn(`TTS Model ${model} failed.`, error);
        lastError = error;
      }
    }
    
    throw new Error(cleanErrorMessage(lastError || new Error("All TTS models failed.")));
    
  } catch (error: any) {
    if (signal?.aborted || error.name === 'AbortError') {
      throw new DOMException("Aborted", "AbortError");
    }
    throw new Error(cleanErrorMessage(error));
  }
};