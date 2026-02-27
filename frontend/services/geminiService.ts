import { GoogleGenAI, Modality } from "@google/genai";
import { GenerationSettings, RemoteSpeaker, ClonedVoice, CharacterProfile, VoiceOption, VoiceSampleAnalysis } from "../types";
import { VOICES, LANGUAGES, SFX_LIBRARY, OPENAI_VOICES, F5_VOICES, KOKORO_VOICES } from "../constants";
import { createSynthesisTraceId, normalizeSynthesisRequest } from "./synthesisContractService";
import { extractEmotionAndCrewTags, normalizeEmotionTag } from "./emotionTagRules";
import { authFetch } from "./authHttpClient";
import {
  MAX_WORDS_PER_WINDOW,
  MAX_WORDS_PER_REQUEST,
  RETRY_ATTEMPTS_PER_CHUNK,
  RETRY_BACKOFF_MS,
  buildSentenceAlignedWordWindows,
  countWords,
  getChunkProfile,
  isPrimaryTtsEngine,
  mergeChunkBuffersWithCrossfade,
  preflightWordLimit,
  sleepMs,
} from "./ttsLongTextService";

// Gemini helper defaults to local runtime/server key pool; user key is optional override.
export const TTS_RUNTIME_DIAGNOSTICS_EVENT = 'voiceflow:tts-runtime-diagnostics';

interface RuntimeDiagnosticsPayload {
  engine?: string;
  traceId?: string;
  chunkCount?: number;
  retryChunks?: number;
  qualityGuardRecoveries?: number;
  splitChunks?: number;
  maxAttempt?: number;
  strategies?: string[];
  recoveryUsed?: boolean;
  runtimeLabel?: string;
}

const resolveGeminiApiKey = (settings: Pick<GenerationSettings, 'geminiApiKey'>): string => {
  return String(settings.geminiApiKey || '').trim();
};

const resolveGeminiRuntimeBaseUrl = (
  settings: Pick<GenerationSettings, 'geminiTtsServiceUrl'>
): string => {
  const raw = String(settings.geminiTtsServiceUrl || 'http://127.0.0.1:7810').trim();
  return raw.replace(/\/+$/, '');
};

const resolveMediaBackendBaseUrl = (
  settings: Pick<GenerationSettings, 'mediaBackendUrl'>
): string => {
  const raw = String(settings.mediaBackendUrl || 'http://127.0.0.1:7800').trim();
  return raw.replace(/\/+$/, '');
};

const formatRetryDelayHint = (retryAfterMs?: number): string => {
  const ms = Number(retryAfterMs || 0);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return ` Retry after about ${seconds}s.`;
};

const MAX_RUNTIME_ERROR_DETAIL_CHARS = 220;
const RUNTIME_QUOTA_MESSAGE = 'Usage limit exceeded. Please check your API keys in settings.';

const collapseRuntimeErrorWhitespace = (value: string): string => {
  return String(value || '').replace(/\s+/g, ' ').trim();
};

const truncateRuntimeErrorDetail = (value: string): string => {
  const normalized = collapseRuntimeErrorWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= MAX_RUNTIME_ERROR_DETAIL_CHARS) return normalized;
  return `${normalized.slice(0, MAX_RUNTIME_ERROR_DETAIL_CHARS - 3).trimEnd()}...`;
};

const isRuntimeQuotaLikeError = (value: string): boolean => {
  const lower = collapseRuntimeErrorWhitespace(value).toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('429') ||
    lower.includes('quota exceeded') ||
    lower.includes('insufficient_quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('resource exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('too many requests')
  );
};

const quotaRuntimeMessage = (retryAfterMs?: number): string => {
  return `${RUNTIME_QUOTA_MESSAGE}${formatRetryDelayHint(retryAfterMs)}`.trim();
};

const normalizeRuntimeUserMessage = (value: string, retryAfterMs?: number): string => {
  const normalized = collapseRuntimeErrorWhitespace(value);
  if (!normalized) return '';
  if (isRuntimeQuotaLikeError(normalized)) {
    return quotaRuntimeMessage(retryAfterMs);
  }
  return truncateRuntimeErrorDetail(normalized);
};

const mapGeminiRuntimeErrorCode = (
  errorCode: string,
  summary: string,
  retryAfterMs?: number
): string | null => {
  const code = String(errorCode || '').trim().toUpperCase();
  const retryHint = formatRetryDelayHint(retryAfterMs);
  if (!code) return null;
  if (code === 'GEMINI_API_KEY_MISSING') {
    return 'Gemini runtime key pool is empty. Configure GEMINI_API_KEYS_FILE (recommended), GEMINI_API_KEYS, or GEMINI_API_KEY.';
  }
  if (code === 'GEMINI_RUNTIME_SDK_UNAVAILABLE') {
    return 'Gemini runtime dependencies are unavailable. Install runtime requirements and restart services.';
  }
  if (code === 'GEMINI_ALL_KEYS_AUTH_FAILED') {
    return 'All Gemini API keys were rejected by upstream auth. Replace invalid keys and retry.';
  }
  if (code === 'GEMINI_ALL_KEYS_RATE_LIMITED') {
    return quotaRuntimeMessage(retryAfterMs);
  }
  if (code === 'GEMINI_KEY_POOL_TIMEOUT') {
    return `Gemini key pool timed out while waiting for an available key.${retryHint}`.trim();
  }
  if (code === 'GEMINI_UPSTREAM_MODEL_FAILED') {
    const normalizedSummary = normalizeRuntimeUserMessage(summary, retryAfterMs);
    return normalizedSummary || 'Gemini upstream model call failed. Retry or switch model/runtime.';
  }
  return null;
};

const parseMaybeJsonObject = (value: unknown): Record<string, any> | null => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    return null;
  }
  return null;
};

const parseRuntimeErrorDetail = (payload: any, status: number, statusText: string): string => {
  const nestedDetail = parseMaybeJsonObject(payload?.detail);
  const detailObj =
    (payload?.detail && typeof payload.detail === 'object' ? payload.detail : null) ||
    nestedDetail;
  const errorCode = String(detailObj?.errorCode || payload?.errorCode || nestedDetail?.errorCode || '').trim();
  const summary = String(
    detailObj?.summary ||
    payload?.summary ||
    detailObj?.error ||
    payload?.error ||
    nestedDetail?.summary ||
    nestedDetail?.error ||
    ''
  ).trim();
  const retryAfterMsRaw = Number(detailObj?.retryAfterMs ?? payload?.retryAfterMs ?? 0);
  const retryAfterMs = Number.isFinite(retryAfterMsRaw) ? retryAfterMsRaw : 0;
  if (errorCode) {
    const mapped = mapGeminiRuntimeErrorCode(errorCode, summary, retryAfterMs);
    const normalizedMapped = normalizeRuntimeUserMessage(mapped || '', retryAfterMs);
    if (normalizedMapped) return normalizedMapped;
    if (mapped && mapped.trim()) return truncateRuntimeErrorDetail(mapped.trim());
  }
  const candidates: string[] = [];
  if (typeof payload?.detail === 'string' && payload.detail.trim()) candidates.push(payload.detail);
  if (typeof payload?.error === 'string' && payload.error.trim()) candidates.push(payload.error);
  if (nestedDetail) {
    const nestedSummary = String(nestedDetail?.summary || nestedDetail?.error || '').trim();
    if (nestedSummary) candidates.push(nestedSummary);
  }
  if (payload?.detail && typeof payload.detail === 'object' && summary) candidates.push(summary);
  if (summary) candidates.push(summary);
  for (const candidate of candidates) {
    const normalized = normalizeRuntimeUserMessage(candidate, retryAfterMs);
    if (normalized) return normalized;
  }
  return truncateRuntimeErrorDetail(`${status} ${statusText}`);
};

const isKnownGeminiPoolMisconfigError = (message: string): boolean => {
  const lower = String(message || '').toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('gemini_api_key_missing') ||
    lower.includes('key pool is empty') ||
    lower.includes('configure gemini_api_keys_file') ||
    lower.includes('api key is missing')
  );
};

const optionalBearerAuthHeaders = (apiKey?: string): Record<string, string> => {
  const token = String(apiKey || '').trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

// --- MODEL FALLBACK LISTS (Priority High -> Low) ---
// Keep direct personal-key mode aligned with runtime allocator routing.
const TEXT_MODELS_FALLBACK = [
  "gemini-2.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash-lite",
  "gemma-3-27b",
  "gemma-3-12b",
  "gemma-3-4b",
  "gemma-3-2b",
  "gemma-3-1b",
];

const TTS_MODELS_FALLBACK = [
  "gemini-2.5-flash-preview-tts",
];

const GEMINI_MODEL_DISCOVERY_TTL_MS = 10 * 60 * 1000;
const GEMINI_MODEL_DISCOVERY_SCAN_LIMIT = 200;

interface DiscoveredGeminiModels {
  fetchedAt: number;
  textModels: string[];
  ttsModels: string[];
}

const discoveredGeminiModelCache = new Map<string, DiscoveredGeminiModels>();

const normalizeGeminiModelName = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^models\//i, '').trim();
};

const hasGenerateContentAction = (actions: unknown): boolean => {
  if (!Array.isArray(actions) || actions.length === 0) return true;
  return actions.some((action) => String(action || '').toLowerCase().includes('generatecontent'));
};

const mergeGeminiModelCandidates = (preferred: string[], discovered: string[], forced?: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushModel = (candidate: string | undefined) => {
    const normalized = normalizeGeminiModelName(String(candidate || ''));
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };
  if (forced) pushModel(forced);
  preferred.forEach((model) => pushModel(model));
  discovered.forEach((model) => pushModel(model));
  return out;
};

const discoverGeminiModels = async (
  ai: GoogleGenAI,
  apiKey: string
): Promise<DiscoveredGeminiModels> => {
  const cacheKey = String(apiKey || '').trim();
  const now = Date.now();
  const cached = discoveredGeminiModelCache.get(cacheKey);
  if (cached && (now - cached.fetchedAt) < GEMINI_MODEL_DISCOVERY_TTL_MS) {
    return cached;
  }

  const textModels: string[] = [];
  const ttsModels: string[] = [];
  const textSeen = new Set<string>();
  const ttsSeen = new Set<string>();

  try {
    const pager: AsyncIterable<any> = await (ai as any).models.list({
      config: { queryBase: true, pageSize: 100 }
    });
    let scanned = 0;
    for await (const model of pager) {
      scanned += 1;
      if (scanned > GEMINI_MODEL_DISCOVERY_SCAN_LIMIT) break;

      const name = normalizeGeminiModelName(String((model as any)?.name || ''));
      if (!name) continue;
      const lowerName = name.toLowerCase();
      if (!lowerName.includes('gemini')) continue;
      if (!hasGenerateContentAction((model as any)?.supportedActions)) continue;

      if (lowerName.includes('tts')) {
        if (!ttsSeen.has(lowerName)) {
          ttsSeen.add(lowerName);
          ttsModels.push(name);
        }
        continue;
      }

      if (
        lowerName.includes('embedding') ||
        lowerName.includes('aqa') ||
        lowerName.includes('image') ||
        lowerName.includes('audio')
      ) {
        continue;
      }

      if (!textSeen.has(lowerName)) {
        textSeen.add(lowerName);
        textModels.push(name);
      }
    }
  } catch (error) {
    console.warn('[Gemini] Model discovery failed. Using static fallbacks.', error);
  }

  const discovered: DiscoveredGeminiModels = {
    fetchedAt: now,
    textModels,
    ttsModels,
  };
  discoveredGeminiModelCache.set(cacheKey, discovered);
  return discovered;
};

const getGeminiModelCandidates = async (
  ai: GoogleGenAI,
  apiKey: string,
  mode: 'text' | 'tts',
  preferred: string[],
  forcedModel?: string
): Promise<string[]> => {
  const discovered = await discoverGeminiModels(ai, apiKey);
  const dynamic = mode === 'tts' ? discovered.ttsModels : discovered.textModels;
  return mergeGeminiModelCandidates(preferred, dynamic, forcedModel);
};

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
  if (
    lowerMsg.includes('is not found for api version') ||
    lowerMsg.includes('not supported for generatecontent') ||
    lowerMsg.includes('call listmodels')
  ) {
    return "Gemini model is unavailable/deprecated for this API version. Retry now (defaults updated) or check model access in your Google AI project.";
  }
  if (
    lowerMsg.includes('only supports text output') ||
    lowerMsg.includes('response modalities') ||
    lowerMsg.includes('audio output')
  ) {
    return "Selected Gemini model is text-only. Switch to a Gemini TTS model (for example gemini-2.5-flash-preview-tts).";
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

const parseRuntimeDiagnosticsHeader = (value: string | null): RuntimeDiagnosticsPayload | null => {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') return null;
    const asArray = Array.isArray((parsed as any).strategies) ? (parsed as any).strategies : [];
    return {
      engine: typeof (parsed as any).engine === 'string' ? (parsed as any).engine : undefined,
      traceId: typeof (parsed as any).traceId === 'string' ? (parsed as any).traceId : undefined,
      chunkCount: Number.isFinite(Number((parsed as any).chunkCount)) ? Number((parsed as any).chunkCount) : undefined,
      retryChunks: Number.isFinite(Number((parsed as any).retryChunks)) ? Number((parsed as any).retryChunks) : undefined,
      qualityGuardRecoveries: Number.isFinite(Number((parsed as any).qualityGuardRecoveries))
        ? Number((parsed as any).qualityGuardRecoveries)
        : undefined,
      splitChunks: Number.isFinite(Number((parsed as any).splitChunks)) ? Number((parsed as any).splitChunks) : undefined,
      maxAttempt: Number.isFinite(Number((parsed as any).maxAttempt)) ? Number((parsed as any).maxAttempt) : undefined,
      strategies: asArray.map((item: any) => String(item || '').trim()).filter(Boolean),
      recoveryUsed: Boolean((parsed as any).recoveryUsed),
    };
  } catch {
    return null;
  }
};

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
  
  // Models to try in order (static + dynamic discovery from ListModels).
  const modelsToTry = await getGeminiModelCandidates(
    ai,
    apiKey,
    'text',
    TEXT_MODELS_FALLBACK,
    options.model
  );
  let lastError: any = null;
  
  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: config
      });
      const text = String(response.text || '').trim();
      if (!text) {
        throw new Error(`Gemini model "${model}" returned empty text.`);
      }
      return text;
    } catch (error: any) {
      console.warn(`[Gemini] ${model} failed.`, error);
      lastError = error;
      if (error.message?.includes("API key")) throw error;
    }
  }
  
  throw new Error(cleanErrorMessage(lastError || new Error("All Gemini models failed.")));
}

async function callGeminiRuntimeText(
  systemPrompt: string,
  userPrompt: string,
  settings: Pick<GenerationSettings, 'mediaBackendUrl' | 'geminiApiKey'>,
  jsonMode: boolean = false
): Promise<string> {
  const baseUrl = resolveMediaBackendBaseUrl(settings);
  const response = await authFetch(`${baseUrl}/ai/generate-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemPrompt,
      userPrompt,
      jsonMode,
      // Optional user key can still be passed to runtime endpoint.
      apiKey: resolveGeminiApiKey(settings),
      temperature: 0.7,
    }),
  }, { requireAuth: true });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = parseRuntimeErrorDetail(payload, response.status, response.statusText);
    throw new Error(`Gemini runtime text request failed: ${detail}`);
  }

  const text = String(payload?.text || '').trim();
  if (!text) {
    throw new Error('Gemini runtime returned empty text.');
  }
  return text;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    throw new Error('Perplexity returned an empty response.');
  }
  return content;
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
    if (provider === 'PERPLEXITY') {
      const perplexityKey = String(settings.perplexityApiKey || '').trim();
      if (!perplexityKey) {
        throw new Error("Perplexity provider selected but API key is missing.");
      }
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ];
      return await callPerplexityChat(messages, perplexityKey);
    }
    
    // Default Gemini path: runtime/server key pool first. User key is optional override.
    const forceUserKey = Boolean(settings.preferUserGeminiKey);
    const geminiKey = resolveGeminiApiKey(settings);
    if (forceUserKey) {
      if (!geminiKey) throw new Error("Personal Gemini key is enabled, but API key is missing.");
      return await callGeminiWithFallback(userPrompt, geminiKey, { systemPrompt, jsonMode });
    }
    return await callGeminiRuntimeText(systemPrompt, userPrompt, settings, jsonMode);
    
  } catch (e: any) {
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

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
  }
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return arrayBufferToBase64(buffer);
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
  const raw = String(name || '').trim();
  const n = raw.toLowerCase().trim();
  const parts = n.split(' ');

  // Hindi + Hinglish kinship/title hints.
  if (/(?:\u092e\u093e\u0901|\u0906\u0902\u091f\u0940|\u0926\u0940\u0926\u0940|\u092c\u0939\u0928|\u092e\u0948\u0921\u092e|\u0936\u094d\u0930\u0940\u092e\u0924\u0940)/u.test(raw)) {
    return 'Female';
  }
  if (/(?:\u092a\u093e\u092a\u093e|\u091a\u093e\u091a\u093e|\u092d\u093e\u0908|\u092d\u0948\u092f\u093e|\u0938\u0930|\u0936\u094d\u0930\u0940\u092e\u093e\u0928)/u.test(raw)) {
    return 'Male';
  }
  if (/\b(mom|mother|mummy|maa|aunty|aunt|didi|sister|madam|mrs|ms)\b/i.test(n)) {
    return 'Female';
  }
  if (/\b(dad|father|papa|uncle|brother|bhai|bhaiya|sir|mr)\b/i.test(n)) {
    return 'Male';
  }
  
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
// Supports multilingual names, mixed punctuation, and multi-tag headers:
// "Mohan (Shouting, Crying): ...", "à¤®à¤¾à¤ (Angry): ...", "Narrator: ..."
export const SPEAKER_REGEX = /^(?:\[[^\]\n]{1,24}\]\s*)?(\*+)?([\p{L}\p{N}][\p{L}\p{M}\p{N}\s.'â€™_-]{0,58}?)(?:\s*[\(\[]([^\)\]]{1,120})[\)\]])?(\*+)?\s*[:ï¼š]\s*(.*)$/su;
export const SFX_REGEX = /^(?:\[|\()(?:SFX|sfx|Sound|SOUND|Music|MUSIC|à¤§à¥à¤µà¤¨à¤¿|à¤¸à¤‚à¤—à¥€à¤¤)[:ï¼š\s]?\s*([^\]\)]+)(?:\]|\))/iu;

const SPEAKER_IGNORE_PREFIXES = [
  'chapter', 'scene', 'part', 'note', 'end', 'sfx',
  'unknown', 'start', 'recap', 'prologue', 'epilogue',
  'act', 'time', 'location', 'title', 'intro', 'outro',
  'credits', 'background', 'camera', 'fade', 'music', 'sound',
  'à¤…à¤§à¥à¤¯à¤¾à¤¯', 'à¤¦à¥ƒà¤¶à¥à¤¯', 'à¤­à¤¾à¤—', 'à¤¸à¤®à¤¾à¤ªà¥à¤¤', 'à¤¶à¥€à¤°à¥à¤·à¤•', 'à¤¸à¤‚à¤—à¥€à¤¤', 'à¤§à¥à¤µà¤¨à¤¿'
];

const normalizeSpeakerName = (raw: string): string => (
  String(raw || '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/[\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const isLikelySpeakerName = (name: string): boolean => {
  const normalized = normalizeSpeakerName(name);
  if (!normalized) return false;
  if (normalized.length > 60) return false;
  if (!/[\p{L}]/u.test(normalized)) return false;
  if (/^\d+$/.test(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (SPEAKER_IGNORE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  if (normalized.split(' ').length > 8) return false;
  return true;
};

const addCrewCueToDialogue = (dialogue: string, crewTags: string[]): string => {
  const cleanedDialogue = String(dialogue || '').trim();
  if (!cleanedDialogue) return '';
  if (!crewTags.length) return cleanedDialogue;
  return `[${crewTags.join(', ')}] ${cleanedDialogue}`;
};

interface ParsedSpeakerLine {
  speaker: string;
  dialogue: string;
  emotion: string;
  emotionTags: string[];
  crewTags: string[];
}

const parseSpeakerLine = (line: string): ParsedSpeakerLine | null => {
  const match = String(line || '').match(SPEAKER_REGEX);
  if (!match) return null;

  const speaker = normalizeSpeakerName(match[2] || '');
  if (!isLikelySpeakerName(speaker)) return null;

  const dialogue = String(match[5] || '').trim();
  const tags = extractEmotionAndCrewTags(match[3]);
  const normalizedPrimaryEmotion = normalizeEmotionTag(tags.primaryEmotion) || 'Neutral';

  return {
    speaker,
    dialogue,
    emotion: normalizedPrimaryEmotion,
    emotionTags: tags.emotionTags,
    crewTags: tags.crewTags,
  };
};

const ATTRIBUTION_VERB_PATTERN =
  '(?:à¤•à¤¹à¤¾|à¤•à¤¹à¤•à¤°|à¤•à¤¹à¤¤à¥€|à¤•à¤¹à¤¤à¤¾|à¤¬à¥‹à¤²à¤¾|à¤¬à¥‹à¤²à¥€|à¤ªà¥‚à¤›à¤¾|à¤ªà¥‚à¤›à¥€|à¤šà¤¿à¤²à¥à¤²à¤¾à¤¯à¤¾|à¤šà¤¿à¤²à¥à¤²à¤¾à¤ˆ|à¤œà¤µà¤¾à¤¬ à¤¦à¤¿à¤¯à¤¾|à¤‰à¤¤à¥à¤¤à¤° à¤¦à¤¿à¤¯à¤¾|à¤¬à¤¤à¤¾à¤¯à¤¾|à¤¬à¤¤à¤¾à¤ˆ|said|asked|replied|shouted|whispered|told)';

const normalizeAttributionText = (value: string): string => (
  String(value || '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
);

const extractFirstQuotedSegment = (value: string): string => {
  const match = String(value || '').match(/["â€œâ€']([^"â€œâ€']{2,320})["â€œâ€']/u);
  return match ? String(match[1] || '').trim() : '';
};

const buildSpeakerHeader = (speaker: string, parsed: ParsedSpeakerLine): string => {
  const tags = [parsed.emotion || 'Neutral', ...parsed.crewTags].filter(Boolean);
  return `${speaker} (${tags.join(', ')}): ${parsed.dialogue}`;
};

const isWeakSpeakerToken = (speaker: string): boolean => {
  const token = normalizeSpeakerName(speaker).toLowerCase();
  if (!token) return true;
  if (token.length <= 2) return true;
  return new Set([
    'unknown',
    'unknown speaker',
    'speaker',
    'someone',
    'he',
    'she',
    'they',
    'vo',
    'woh',
    'wo',
    'usne',
    'vah',
    '\u0935\u094b',
    '\u0935\u0939',
    '\u0909\u0938\u0928\u0947',
  ]).has(token);
};

const normalizeHeaderKey = (value: string): string => (
  normalizeSpeakerName(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
);

const normalizeScriptTextLine = (line: string): string => (
  String(line || '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/[â€œâ€"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const normalizeDirectedTitleMeta = (sourceText: string, directedScript: string): string => {
  const lines = String(directedScript || '').split('\n');
  const firstIndex = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstIndex < 0) return directedScript;

  const firstLine = String(lines[firstIndex] || '').trim();
  if (parseSpeakerLine(firstLine) || SFX_REGEX.test(firstLine)) return directedScript;

  const sourceFirstLine = String(sourceText || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .find((line) => line.length > 0) || '';
  const normalizedFirst = normalizeScriptTextLine(firstLine).toLowerCase();
  const normalizedSourceFirst = normalizeScriptTextLine(sourceFirstLine).toLowerCase();
  const looksLikeTitle =
    normalizedFirst.length > 0 &&
    normalizedFirst.length <= 120 &&
    (
      normalizedFirst === normalizedSourceFirst ||
      /\b(title|story|chapter)\b/i.test(normalizedFirst) ||
      /(?:\u0915\u0939\u093e\u0928\u0940|\u0936\u0940\u0930\u094d\u0937\u0915|\u0905\u0927\u094d\u092f\u093e\u092f)/u.test(firstLine)
    );
  if (!looksLikeTitle) return directedScript;

  lines[firstIndex] = `Narrator (Neutral): ${firstLine.replace(/^["â€œâ€']|["â€œâ€']$/g, '').trim()}`;
  return lines.join('\n');
};

const extractQuoteAttributionsFromSource = (sourceText: string): Map<string, string> => {
  const mapping = new Map<string, string>();
  const source = String(sourceText || '');
  if (!source.trim()) return mapping;

  // Pattern A: Speaker ... said, "quote"
  const patternA = new RegExp(
    `([\\p{L}\\p{M}\\p{N}][\\p{L}\\p{M}\\p{N}\\s.'_-]{0,60}?)\\s*(?:à¤¨à¥‡\\s*)?${ATTRIBUTION_VERB_PATTERN}\\s*[,ï¼Œ:ï¼š-]?\\s*["â€œâ€']([^"â€œâ€']{2,320})["â€œâ€']`,
    'giu'
  );
  for (const match of source.matchAll(patternA)) {
    const speaker = normalizeSpeakerName(String(match[1] || ''));
    const quote = normalizeAttributionText(String(match[2] || ''));
    if (!speaker || !quote || !isLikelySpeakerName(speaker)) continue;
    if (!mapping.has(quote)) mapping.set(quote, speaker);
  }

  // Pattern B: "quote," Speaker said ...
  const patternB = new RegExp(
    `["â€œâ€']([^"â€œâ€']{2,320})["â€œâ€']\\s*[,ï¼Œ]?\\s*([\\p{L}\\p{M}\\p{N}][\\p{L}\\p{M}\\p{N}\\s.'_-]{0,60}?)\\s*(?:à¤¨à¥‡\\s*)?${ATTRIBUTION_VERB_PATTERN}`,
    'giu'
  );
  for (const match of source.matchAll(patternB)) {
    const quote = normalizeAttributionText(String(match[1] || ''));
    const speaker = normalizeSpeakerName(String(match[2] || ''));
    if (!speaker || !quote || !isLikelySpeakerName(speaker)) continue;
    if (!mapping.has(quote)) mapping.set(quote, speaker);
  }

  return mapping;
};

const resolveAttributedSpeaker = (dialogue: string, quoteSpeakerMap: Map<string, string>): string | undefined => {
  const directQuote = normalizeAttributionText(extractFirstQuotedSegment(dialogue));
  if (directQuote && quoteSpeakerMap.has(directQuote)) return quoteSpeakerMap.get(directQuote);

  const normalizedDialogue = normalizeAttributionText(dialogue);
  if (!normalizedDialogue) return undefined;
  if (quoteSpeakerMap.has(normalizedDialogue)) return quoteSpeakerMap.get(normalizedDialogue);
  return undefined;
};

export const enforceAttributionFidelity = (
  sourceText: string,
  directedScript: string
): { script: string; rewrites: number } => {
  const normalizedDirected = normalizeDirectedTitleMeta(sourceText, directedScript);
  const lines = String(normalizedDirected || '').split('\n');
  if (!lines.length) return { script: normalizedDirected, rewrites: 0 };

  const quoteSpeakerMap = extractQuoteAttributionsFromSource(sourceText);
  if (!quoteSpeakerMap.size) return { script: normalizedDirected, rewrites: 0 };

  const aliasMap = new Map<string, string>();
  let rewrites = 0;

  const rewrittenLines = lines.map((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || SFX_REGEX.test(trimmed)) return line;

    const parsed = parseSpeakerLine(trimmed);
    if (!parsed) {
      const quoted = extractFirstQuotedSegment(trimmed);
      const attributed = quoted ? resolveAttributedSpeaker(quoted, quoteSpeakerMap) : undefined;
      if (attributed && isLikelySpeakerName(attributed)) {
        rewrites += 1;
        return `${attributed} (Neutral): ${quoted || trimmed}`;
      }
      return line;
    }

    const speakerKey = normalizeHeaderKey(parsed.speaker);
    let nextSpeaker = aliasMap.get(speakerKey) || parsed.speaker;
    const attributedSpeaker = resolveAttributedSpeaker(parsed.dialogue, quoteSpeakerMap);
    if (attributedSpeaker && isLikelySpeakerName(attributedSpeaker)) {
      const normalizedDialogue = normalizeAttributionText(parsed.dialogue);
      const exactDialogueSpeaker = normalizedDialogue ? quoteSpeakerMap.get(normalizedDialogue) : undefined;
      const canRewrite =
        /^narrator$/i.test(parsed.speaker) ||
        isWeakSpeakerToken(parsed.speaker) ||
        normalizeAttributionText(parsed.speaker) === normalizeAttributionText(attributedSpeaker) ||
        exactDialogueSpeaker === attributedSpeaker;
      if (canRewrite && nextSpeaker !== attributedSpeaker) {
        aliasMap.set(speakerKey, attributedSpeaker);
        nextSpeaker = attributedSpeaker;
      }
    } else if (/^narrator$/i.test(parsed.speaker)) {
      const quoted = extractFirstQuotedSegment(parsed.dialogue);
      if (quoted) {
        rewrites += 1;
        return `Unknown Speaker (Neutral): ${quoted}`;
      }
    } else if (aliasMap.has(speakerKey)) {
      const canonical = aliasMap.get(speakerKey) || parsed.speaker;
      if (canonical !== parsed.speaker) {
        rewrites += 1;
        return buildSpeakerHeader(canonical, parsed);
      }
    }

    if (nextSpeaker !== parsed.speaker) {
      rewrites += 1;
      return buildSpeakerHeader(nextSpeaker, parsed);
    }
    return line;
  });

  return { script: rewrittenLines.join('\n'), rewrites };
};

const normalizeSfxToken = (value: string): string => (
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
);

const estimateSfxDurationSeconds = (label: string): number => {
  const normalized = normalizeSfxToken(label);
  if (!normalized) return 1.0;
  if (/(rain|wind|storm|ambient|ocean|forest)/.test(normalized)) return 4.0;
  if (/(thunder|explosion|boom|crash)/.test(normalized)) return 2.0;
  if (/(door|lock|unlock|knock|click|beep)/.test(normalized)) return 1.0;
  if (/(whoosh|swipe|transition|boost)/.test(normalized)) return 0.8;
  if (/(footstep|walk|running)/.test(normalized)) return 1.8;
  return 1.2;
};

const resolveSfxItem = (label: string) => {
  const normalized = normalizeSfxToken(label);
  if (!normalized) return null;

  const exact = SFX_LIBRARY.find((item) => (
    normalizeSfxToken(item.id) === normalized ||
    normalizeSfxToken(item.name) === normalized
  ));
  if (exact) return exact;

  const contains = SFX_LIBRARY.find((item) => {
    const id = normalizeSfxToken(item.id);
    const name = normalizeSfxToken(item.name);
    return id.includes(normalized) || normalized.includes(id) || name.includes(normalized) || normalized.includes(name);
  });
  if (contains) return contains;

  return SFX_LIBRARY.find((item) => (
    item.tags.some((tag) => {
      const token = normalizeSfxToken(tag);
      return token.includes(normalized) || normalized.includes(token);
    })
  )) || null;
};

const createNoiseBuffer = (ctx: AudioContext, durationSec: number, gain = 0.4): AudioBuffer => {
  const duration = Math.max(0.2, durationSec);
  const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < frameCount; i += 1) {
    // Brown-ish noise gives softer ambience than pure white noise.
    const white = (Math.random() * 2) - 1;
    prev = (prev + (0.02 * white)) / 1.02;
    const envelope = Math.max(0, 1 - (i / frameCount));
    data[i] = Math.max(-1, Math.min(1, prev * gain * envelope * 3.5));
  }
  return buffer;
};

const createProceduralSfxBuffer = (ctx: AudioContext, label: string): AudioBuffer => {
  const normalized = normalizeSfxToken(label);
  const duration = estimateSfxDurationSeconds(normalized);

  // Base layer: enveloped noise.
  const buffer = createNoiseBuffer(ctx, duration, /(rain|wind|ambient|ocean|forest)/.test(normalized) ? 0.3 : 0.55);
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;

  if (/(footstep|walk|running|knock|door)/.test(normalized)) {
    const stepEvery = Math.max(0.2, /(running)/.test(normalized) ? 0.28 : 0.45);
    for (let t = 0; t < duration; t += stepEvery) {
      const start = Math.floor(t * sampleRate);
      const end = Math.min(data.length, start + Math.floor(0.06 * sampleRate));
      for (let i = start; i < end; i += 1) {
        const phase = (i - start) / Math.max(1, (end - start));
        const env = Math.exp(-12 * phase);
        data[i] += Math.sin((2 * Math.PI * 180 * (i / sampleRate))) * 0.35 * env;
      }
    }
  }

  if (/(thunder|explosion|boom|crash)/.test(normalized)) {
    for (let i = 0; i < data.length; i += 1) {
      const t = i / sampleRate;
      const sub = Math.sin(2 * Math.PI * 52 * t) * Math.exp(-1.9 * t) * 0.55;
      data[i] = Math.max(-1, Math.min(1, data[i] + sub));
    }
  }

  if (/(beep|alert|notification|level up)/.test(normalized)) {
    for (let i = 0; i < data.length; i += 1) {
      const t = i / sampleRate;
      const tone = Math.sin(2 * Math.PI * 880 * t) * Math.exp(-8 * t) * 0.45;
      data[i] = Math.max(-1, Math.min(1, (data[i] * 0.25) + tone));
    }
  }

  return buffer;
};

export function parseMultiSpeakerScript(text: string) {
  const lines = text.split('\n');
  const uniqueSpeakers = new Map<string, string>();
  const crewTags = new Set<string>();

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 2) return;
    if (SFX_REGEX.test(trimmed)) return;

    const parsed = parseSpeakerLine(trimmed);
    if (!parsed) return;
    const key = parsed.speaker.toLowerCase();
    if (!uniqueSpeakers.has(key)) uniqueSpeakers.set(key, parsed.speaker);
    parsed.crewTags.forEach((tag) => crewTags.add(tag));
  });

  const speakersList = Array.from(uniqueSpeakers.values());
  return {
    isMultiSpeaker: speakersList.length > 0,
    speakersList,
    crewTagsList: Array.from(crewTags),
  };
}

export const parseStudioDialogue = (text: string): {
  speaker?: string;
  text: string;
  isSfx?: boolean;
  emotion?: string;
  crewTags?: string[];
  emotionTags?: string[];
}[] => {
  const lines = text.split('\n');
  const segments: {
    speaker?: string;
    text: string;
    isSfx?: boolean;
    emotion?: string;
    crewTags?: string[];
    emotionTags?: string[];
  }[] = [];

  let currentSpeaker = 'Narrator';
  let currentEmotion = 'Neutral';
  let currentCrewTags: string[] = [];
  let currentEmotionTags: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Check for SFX first
    const sfxMatch = trimmed.match(SFX_REGEX);
    if (sfxMatch) {
      segments.push({ speaker: 'SFX', text: sfxMatch[1].trim(), isSfx: true });
      return;
    }

    const parsed = parseSpeakerLine(trimmed);
    if (parsed) {
      currentSpeaker = parsed.speaker;
      currentEmotion = parsed.emotion || 'Neutral';
      currentCrewTags = parsed.crewTags;
      currentEmotionTags = parsed.emotionTags;
      const dialogueWithCue = addCrewCueToDialogue(parsed.dialogue, parsed.crewTags);

      if (dialogueWithCue) {
        segments.push({
          speaker: currentSpeaker,
          text: dialogueWithCue,
          emotion: currentEmotion,
          crewTags: currentCrewTags,
          emotionTags: currentEmotionTags,
        });
      }
    } else {
      // Continuation line or direction line.
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
          const direction = trimmed.slice(1, -1).trim();
          segments.push({
            speaker: 'Narrator',
            text: addCrewCueToDialogue(direction || trimmed, direction ? [direction] : []),
            emotion: 'Neutral',
            crewTags: direction ? [direction] : [],
            emotionTags: [],
          });
      } else {
          segments.push({
            speaker: currentSpeaker,
            text: addCrewCueToDialogue(trimmed, currentCrewTags),
            emotion: currentEmotion,
            crewTags: currentCrewTags,
            emotionTags: currentEmotionTags,
          });
      }
    }
  });

  return segments;
};

export const parseScriptToSegments = (text: string): {
  startTime: number;
  endTime?: number;
  speaker: string;
  text: string;
  emotion?: string;
  crewTags?: string[];
  emotionTags?: string[];
}[] => {
  const lines = text.split('\n');
  const segments: {
    startTime: number;
    endTime?: number;
    speaker: string;
    text: string;
    emotion?: string;
    crewTags?: string[];
    emotionTags?: string[];
  }[] = [];
  let fallbackCursor = 0;
  let currentSpeaker = 'Narrator';
  let currentEmotion = 'Neutral';
  let currentCrewTags: string[] = [];
  let currentEmotionTags: string[] = [];

  const timeToSeconds = (timestamp: string) => {
    const parts = String(timestamp || '').split(':').map((part) => Number(part));
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    return 0;
  };

  const estimateSpeechDuration = (dialogue: string) => {
    const words = dialogue.trim().split(/\s+/).filter(Boolean).length;
    const punctuation = (dialogue.match(/[,.!?;:]/g) || []).length;
    const base = Math.max(1, words) / 2.6;
    return Math.max(0.7, Math.min(12, base + (punctuation * 0.08)));
  };
  
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let working = trimmed;
    let explicitStart: number | undefined;
    let explicitEnd: number | undefined;

    // Accept [00:00], (00:00), bare 00:00, and range formats like (00:01.20-00:03.85).
    const timestampMatch = working.match(
      /^[\[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)(?:\s*[-â€“]\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?))?\s*[\])]?\s*(.*)$/
    );
    if (timestampMatch) {
      explicitStart = timeToSeconds(timestampMatch[1]);
      if (timestampMatch[2]) {
        const parsedEnd = timeToSeconds(timestampMatch[2]);
        if (parsedEnd > explicitStart) explicitEnd = parsedEnd;
      }
      working = (timestampMatch[3] || '').trim();
    }

    if (!working) return;

    const sfxMatch = working.match(SFX_REGEX);
    if (sfxMatch) {
      const label = sfxMatch[1].trim();
      const start = explicitStart ?? fallbackCursor;
      const dur = estimateSfxDurationSeconds(label);
      segments.push({
        startTime: start,
        endTime: explicitEnd,
        speaker: 'SFX',
        text: label,
        emotion: 'Neutral',
      });
      fallbackCursor = explicitEnd && explicitEnd > start ? explicitEnd : start + dur;
      return;
    }

    const parsed = parseSpeakerLine(working);
    if (parsed) {
      currentSpeaker = parsed.speaker;
      currentEmotion = parsed.emotion || 'Neutral';
      currentCrewTags = parsed.crewTags;
      currentEmotionTags = parsed.emotionTags;

      const dialogue = addCrewCueToDialogue(parsed.dialogue, parsed.crewTags);
      if (!dialogue) return;

      const start = explicitStart ?? fallbackCursor;
      segments.push({
        startTime: start,
        endTime: explicitEnd,
        speaker: currentSpeaker,
        text: dialogue,
        emotion: currentEmotion,
        crewTags: currentCrewTags,
        emotionTags: currentEmotionTags,
      });
      fallbackCursor = explicitEnd && explicitEnd > start ? explicitEnd : start + estimateSpeechDuration(dialogue);
      return;
    }

    const fallbackDialogue = addCrewCueToDialogue(working, currentCrewTags);
    if (!fallbackDialogue) return;

    const start = explicitStart ?? fallbackCursor;
    segments.push({
      startTime: start,
      endTime: explicitEnd,
      speaker: currentSpeaker,
      text: fallbackDialogue,
      emotion: currentEmotion,
      crewTags: currentCrewTags,
      emotionTags: currentEmotionTags,
    });
    fallbackCursor = explicitEnd && explicitEnd > start ? explicitEnd : start + estimateSpeechDuration(fallbackDialogue);
  });

  return segments;
};

// --- AI DIRECTOR SERVICES ---
export const autoCorrectText = async (text: string, settings: GenerationSettings): Promise<string> => {
  const systemPrompt = `You are an expert Audio Script Editor.
Transform the input text into a production-ready Audio Script.

RULES:
1. EVERY line must start with "Speaker Name (PrimaryEmotion[, CueTag...]): ".
2. Use "Narrator (Neutral): " for descriptive text.
3. Keep performance cues that are not emotions as extra tags (example: "Mohan (Shouting, Crying): ...", "Mohan (Neutral, Wearing earphones): ...").
4. Fix grammar/spelling.
5. Preserve original meaning and structure.

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
  let systemPrompt = `You are an Expert Audio Script Editor and Proofreader.
Your goal is to prepare text for Ultra-Realistic Text-to-Speech synthesis.

MODES:
1. GRAMMAR: Fix spelling, punctuation, and capitalization errors only. Keep phrasing exact.
2. FLOW (Default): Fix grammar AND improve sentence rhythm for natural speech. Use contractions (it is -> it's). Add commas for breathing pauses.
3. CREATIVE: Enhance vocabulary and emotion. Make dialogue punchy, dramatic, and natural.

CRITICAL RULES for REALISM:
1. NEVER remove or alter "Speaker Name:" or "(PrimaryEmotion[, CueTag...])" tags.
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
      2. **Advanced Tags**: Use speaker tags in this format: (PrimaryEmotion[, CueTag...]). Example: (Shouting, Crying), (Neutral, Wearing earphones), (Angry), (Laughing).
      3. **Sound Effects**: Detect context and insert [SFX: Sound Description] tags where appropriate (e.g. footsteps, door slams, rain).
      4. **Hinglish Support**: If the text seems to be in an Indian context, ensure "Hinglish" (Hindi + English) phrasing is natural and urban.
      5. **Attribution Fidelity (Highest Priority)**: Keep original story flow and event order. If source says X said "Y", output MUST include 'X (...): Y'.
      6. **Dialogue Conversion Rule**: Convert to character dialogue ONLY when source indicates someone is speaking. Do not over-convert narrative prose into fake conversations.
      7. **Narrator Usage**: Use "Narrator (Neutral):" only for non-spoken prose.
      8. **Name Script Consistency**: Keep character names in the same script style as source text across all lines.
      9. **Pacing**: Use ellipses (...) for suspense and hesitation.
      
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

const suggestMusicTrackFromMood = (rawMood: unknown): string | undefined => {
  const mood = String(rawMood || '').trim().toLowerCase();
  if (!mood) return undefined;
  if (/(romance|romantic|love|tender|warm)/.test(mood)) return 'm_novel_romance_glow';
  if (/(mystery|suspense|thrill|tense|dark|horror|fear)/.test(mood)) return 'm_novel_tension_dark';
  if (/(fun|funny|comedy|comic|light|playful)/.test(mood)) return 'm_novel_comedy_bounce';
  if (/(adventure|epic|heroic|cinematic|grand|dramatic)/.test(mood)) return 'm_novel_cinematic_arc';
  if (/(calm|peaceful|soft|ambient|nostalgic|melancholic|sad)/.test(mood)) return 'm_novel_ambient_pages';
  return 'm_novel_mystery_night';
};

export const autoFormatScript = async (
  text: string,
  settings: GenerationSettings,
  mode: 'audio_drama' = 'audio_drama',
  options?: DirectorOptions,
  existingCharacters: CharacterProfile[] = []
): Promise<{
  formattedText: string,
  cast: {
    name: string,
    gender: 'Male' | 'Female' | 'Unknown',
    age?: 'Child' | 'Young Adult' | 'Adult' | 'Elderly'
  }[],
  crewTags?: string[],
  mood?: string,
  suggestedMusicTrackId?: string
}> => {
  const castContext = existingCharacters.length > 0
    ? `**EXISTING CAST:** ${existingCharacters.map(c => `${c.name} (${c.gender})`).join(', ')}. Reuse these if applicable.`
    : "Detect characters.";
  const requestedMode = 'audio drama';
  const requestedStyle = options?.style || 'natural';
  const requestedTone = options?.tone || 'neutral';
  
  const systemPrompt = `You are a World-Class Audio Drama Director.
Transform input text into a strict audio script format.

${castContext}
Target mode: ${requestedMode}
Preferred style: ${requestedStyle}
Preferred tone: ${requestedTone}

**TASK:**
1. Identify speakers. Detect Gender (Male/Female) and Age (Child/Young Adult/Adult/Elderly).
2. Preserve original narrative sequence and meaning.
3. Convert prose to dialogue format only where source indicates speech: "Character (PrimaryEmotion[, CueTag...]): Dialogue".
4. ADVANCED TAG RULES:
   - First tag must be an emotion (e.g., Neutral, Angry, Calm, Sad, Happy, Shouting, Crying).
   - Additional comma-separated tags are crew/performance cues (e.g., Wearing earphones, Whispering to self, Smiling).
   - Keep emotion and cue tags concise.
5. For quoted/direct speech in source, always emit an explicit speaker line. Do not swallow attributed speech inside narrator lines.
6. Keep narrator lines only for non-spoken prose.
7. Speaker names must remain in source script consistently across all lines.
8. If speaker is unknown, use "Unknown Speaker (Neutral): ...".
9. Preserve capitalization for character names.
10. Never invent new conversations that are not implied by the source text.
11. Language Fidelity: Keep output in the same language(s), script(s), and code-switch pattern as the source text. Do not translate, normalize, or romanize unless already present in the source.

Bad example (do not do this):
Narrator (Neutral): Mother told him to buy vegetables.

Good example:
माँ (Neutral): मोहन, ज़रा सब्ज़ी लेने चले जाओ।

**Output JSON Schema:**
{
  "cast": [
    { "name": "string", "gender": "Male|Female|Unknown", "age": "string" }
  ],
  "script": "string (The full formatted script text. NO MARKDOWN.)",
  "mood": "string"
}

Language Lock: Preserve source-language output exactly; no cross-language conversion.

IMPORTANT: Return ONLY valid JSON with NO additional text.`;
  
  const userPrompt = `Direct this text (preserve its original language/script exactly):\n"${text.substring(0, 50000)}"`;
  
  try {
    const resultText = await generateText(systemPrompt, userPrompt, settings, true);
    const json = extractJSON(resultText);
    
    if (!json || !json.script) {
      const fallbackParse = parseMultiSpeakerScript(text);
      return {
        formattedText: text,
        cast: fallbackParse.speakersList.map((name) => ({
          name,
          gender: guessGenderFromName(name),
        })),
        crewTags: fallbackParse.crewTagsList || [],
      };
    }

    const scriptText = String(json.script || text);
    const attributionGuard = enforceAttributionFidelity(text, scriptText);
    const finalScriptText = attributionGuard.script;
    if (attributionGuard.rewrites > 0) {
      console.debug(`[ai-director] attribution_guard_rewrites=${attributionGuard.rewrites}`);
    }
    const parsedFromScript = parseMultiSpeakerScript(finalScriptText);
    const castMap = new Map<string, {
      name: string;
      gender: 'Male' | 'Female' | 'Unknown';
      age?: 'Child' | 'Young Adult' | 'Adult' | 'Elderly';
    }>();

    const rawCast = Array.isArray(json.cast) ? json.cast : [];
    rawCast.forEach((entry: any) => {
      const name = normalizeSpeakerName(String(entry?.name || ''));
      if (!name) return;
      if (!isLikelySpeakerName(name)) return;
      const genderRaw = String(entry?.gender || '').trim().toLowerCase();
      const ageRaw = String(entry?.age || '').trim();
      const key = name.toLowerCase();
      castMap.set(key, {
        name,
        gender: genderRaw === 'male' ? 'Male' : genderRaw === 'female' ? 'Female' : 'Unknown',
        age: ageRaw === 'Child' || ageRaw === 'Young Adult' || ageRaw === 'Adult' || ageRaw === 'Elderly'
          ? ageRaw
          : undefined,
      });
    });

    parsedFromScript.speakersList.forEach((speaker) => {
      const key = speaker.toLowerCase();
      if (castMap.has(key)) return;
      castMap.set(key, {
        name: speaker,
        gender: guessGenderFromName(speaker),
      });
    });

    return {
      formattedText: finalScriptText,
      cast: Array.from(castMap.values()),
      crewTags: parsedFromScript.crewTagsList || [],
      mood: json.mood,
      suggestedMusicTrackId: suggestMusicTrackFromMood(json.mood),
    };
  } catch (e: any) {
    throw new Error(cleanErrorMessage(e));
  }
};

// --- DETECTION SERVICES ---
export const detectLanguage = async (text: string, _settings: GenerationSettings): Promise<string> => {
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
1. Preserve all timestamps exactly, including ranges like (00:00.00-00:03.50).
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
  const geminiKey = resolveGeminiApiKey(settings);
  if (!geminiKey) throw new Error("API Key missing");
  const base64Audio = await blobToBase64(audioBlob);
  
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

export const analyzeVoiceSample = async (_audioBlob: Blob, settings: GenerationSettings): Promise<VoiceSampleAnalysis> => {
  const audioBlob = _audioBlob;
  const geminiKey = resolveGeminiApiKey(settings);
  if (!geminiKey) {
    throw new Error('Voice analysis failed. Configure Gemini API key.');
  }

  const base64Audio = await blobToBase64(audioBlob);
  const contentParts = [
    { inlineData: { mimeType: audioBlob.type || 'audio/wav', data: base64Audio } },
    {
      text: [
        'Analyze this voice sample for TTS voice cloning.',
        'Return strict JSON:',
        '{',
        '  "description": "short voice profile summary",',
        '  "emotion": "Neutral|Happy|Sad|Angry|Excited|Calm",',
        '  "style": "default or style label",',
        '  "confidence": 0.0',
        '}',
      ].join('\n'),
    },
  ];
  const raw = await callGeminiWithFallback(contentParts, geminiKey, { jsonMode: true });
  const parsed = extractJSON(raw);
  const description = String(parsed?.description || '').trim();
  const emotionRaw = String(parsed?.emotion || '').trim();
  const emotion = normalizeEmotionTag(emotionRaw) || emotionRaw;
  const style = String(parsed?.style || '').trim();
  const confidenceRaw = Number(parsed?.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : undefined;
  if (!description) {
    throw new Error('Voice analysis returned invalid response.');
  }
  return {
    description,
    emotionHint: emotion
      ? {
          emotion,
          style: style || undefined,
          confidence,
        }
      : undefined,
  };
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
  const runtimeSettings = settings as GenerationSettings & {
    engine?: string;
    backendUrl?: string;
    backendApiKey?: string;
    chatterboxId?: string;
    openaiModel?: string;
    f5Model?: string;
    enableWebGpu?: boolean;
    runtimeVoiceCatalog?: VoiceOption[];
    runtimeSpeakerHint?: string;
  };
  const runtimeVoiceCatalog = Array.isArray(runtimeSettings.runtimeVoiceCatalog)
    ? runtimeSettings.runtimeVoiceCatalog
    : [];
  const allowPersonalGeminiBypass = Boolean(runtimeSettings.preferUserGeminiKey);
  const rawEngine = String(runtimeSettings.engine || 'GEM').trim().toUpperCase();
  const activeEngine =
    rawEngine === 'GEMINI'
      ? 'GEM'
      : rawEngine === 'KOKORO_RUNTIME'
        ? 'KOKORO'
        : rawEngine;
  const runtimeEngine: GenerationSettings['engine'] =
    activeEngine === 'KOKORO' ? 'KOKORO' : 'GEM';
  const primaryEngine = isPrimaryTtsEngine(activeEngine) ? activeEngine : null;
  const traceId = createSynthesisTraceId(runtimeEngine);
  
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!text || text.trim().length === 0) throw new Error("Input text is empty.");
  
  // Determine language
  const normalizeLanguageCode = (value: string | undefined): string => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'en';
    return normalized.split(/[-_]/)[0] || 'en';
  };

  const inferLanguageFromText = (value: string): string => {
    const sample = String(value || '');
    if (!sample.trim()) return 'en';
    if (/[\u0900-\u097F]/.test(sample)) return 'hi';
    if (/\b(kya|kyu|kaise|main|tum|aap|hai|hain|tha|thi|kar|mera|meri|nahi|acha|accha)\b/i.test(sample)) return 'hi';
    if (/[\u4e00-\u9fff]/.test(sample)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) return 'ja';
    if (/[\uac00-\ud7af]/.test(sample)) return 'ko';
    return 'en';
  };

  let lang = 'en';
  if (settings.language && settings.language !== 'Auto') {
    const langObj = LANGUAGES.find(
      (l) => l.name === settings.language || l.code.toLowerCase() === settings.language.toLowerCase()
    );
    lang = normalizeLanguageCode(langObj ? langObj.code : settings.language);
  } else {
    lang = inferLanguageFromText(text);
  }
  if (lang === 'hi-latn') lang = 'hi';
  
  // Clean text helper (removes metadata)
  const cleanText = (rawText: string) => {
    const lines = String(rawText || '').split('\n');
    const cleanedLines: string[] = [];

    for (const line of lines) {
      let working = line.trim();
      if (!working) continue;

      // Remove leading timestamp labels.
      working = working.replace(/^[\[(]?\s*\d{1,2}:\d{2}(?::\d{2})?\s*[\])]?\s*/, '').trim();
      if (!working) continue;

      if (SFX_REGEX.test(working)) continue;

      const parsed = parseSpeakerLine(working);
      if (parsed?.dialogue) {
        const emotionCue =
          parsed.emotion && parsed.emotion !== 'Neutral'
            ? `(Tone: ${parsed.emotion}) `
            : '';
        const crewCue = parsed.crewTags.length ? `(${parsed.crewTags.join(', ')}) ` : '';
        cleanedLines.push(`${emotionCue}${crewCue}${parsed.dialogue}`.trim());
        continue;
      }

      const debracketed = working.replace(/\[.*?\]/g, '').trim();
      if (debracketed) cleanedLines.push(debracketed);
    }

    return cleanedLines.join(' ').replace(/\s+/g, ' ').trim();
  };

  const normalizeRuntimeUrl = (url: string | undefined, fallback: string): string => {
    const normalized = String(url || '').trim().replace(/\/+$/, '');
    if (normalized) return normalized;
    return fallback.replace(/\/+$/, '');
  };

  const parseRuntimeError = async (response: Response): Promise<string> => {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    try {
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        return parseRuntimeErrorDetail(payload, response.status, response.statusText);
      }
      const detail = await response.text();
      if (detail?.trim()) {
        const normalized = normalizeRuntimeUserMessage(detail);
        if (normalized) return normalized;
      }
    } catch {
      // noop
    }
    return truncateRuntimeErrorDetail(`${response.status} ${response.statusText}`);
  };

  const synthesizeViaRuntime = async (
    runtimeUrl: string,
    endpointPath: string,
    payload: Record<string, unknown>,
    runtimeLabel: string
  ): Promise<AudioBuffer> => {
    const response = await fetch(`${runtimeUrl}${endpointPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const detail = await parseRuntimeError(response);
      throw new Error(`${runtimeLabel} failed (${response.status}): ${detail}`);
    }
    const responseTraceId = response.headers.get('x-voiceflow-trace-id') || String((payload as any)?.trace_id || '');
    if (responseTraceId) {
      console.debug(`[TTS][${runtimeLabel}] trace_id=${responseTraceId}`);
    }
    const runtimeDiagnostics = parseRuntimeDiagnosticsHeader(response.headers.get('x-voiceflow-diagnostics'));
    if (runtimeDiagnostics) {
      const detail: RuntimeDiagnosticsPayload = {
        ...runtimeDiagnostics,
        traceId: runtimeDiagnostics.traceId || responseTraceId || undefined,
        runtimeLabel,
      };
      if (detail.recoveryUsed) {
        console.info(
          `[TTS][${runtimeLabel}] recovery used ` +
          `(retryChunks=${detail.retryChunks || 0}, qualityRecoveries=${detail.qualityGuardRecoveries || 0}, splitChunks=${detail.splitChunks || 0})`
        );
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(TTS_RUNTIME_DIAGNOSTICS_EVENT, { detail }));
      }
    }

    const audioBytes = await response.arrayBuffer();
    if (audioBytes.byteLength < 100) {
      throw new Error(`${runtimeLabel} returned empty audio.`);
    }

    return await ctx.decodeAudioData(audioBytes);
  };

  const synthesizeViaBackendGateway = async (
    engine: 'GEM' | 'KOKORO',
    runtimeUrl: string,
    endpointPath: string,
    payload: Record<string, unknown>,
    runtimeLabel: string
  ): Promise<AudioBuffer> => {
    const backendBase = resolveMediaBackendBaseUrl(settings);
    let response: Response;
    try {
      response = await authFetch(
        `${backendBase}/tts/synthesize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify({
            ...payload,
            engine,
          }),
          signal,
        },
        { requireAuth: true }
      );
    } catch (gatewayError: any) {
      // Allow graceful fallback to direct runtime when backend gateway is unavailable.
      const lower = String(gatewayError?.message || '').toLowerCase();
      if (lower.includes('failed to fetch') || lower.includes('network')) {
        return await synthesizeViaRuntime(runtimeUrl, endpointPath, payload, runtimeLabel);
      }
      throw gatewayError;
    }

    if (response.status === 404 || response.status === 501) {
      return await synthesizeViaRuntime(runtimeUrl, endpointPath, payload, runtimeLabel);
    }
    if (!response.ok) {
      const detail = await parseRuntimeError(response);
      throw new Error(`${runtimeLabel} failed (${response.status}): ${detail}`);
    }

    const responseTraceId = response.headers.get('x-voiceflow-trace-id') || String((payload as any)?.trace_id || '');
    if (responseTraceId) {
      console.debug(`[TTS][${runtimeLabel}] trace_id=${responseTraceId}`);
    }
    const runtimeDiagnostics = parseRuntimeDiagnosticsHeader(response.headers.get('x-voiceflow-diagnostics'));
    if (runtimeDiagnostics) {
      const detail: RuntimeDiagnosticsPayload = {
        ...runtimeDiagnostics,
        traceId: runtimeDiagnostics.traceId || responseTraceId || undefined,
        runtimeLabel,
      };
      if (detail.recoveryUsed) {
        console.info(
          `[TTS][${runtimeLabel}] recovery used ` +
          `(retryChunks=${detail.retryChunks || 0}, qualityRecoveries=${detail.qualityGuardRecoveries || 0}, splitChunks=${detail.splitChunks || 0})`
        );
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(TTS_RUNTIME_DIAGNOSTICS_EVENT, { detail }));
      }
    }

    const audioBytes = await response.arrayBuffer();
    if (audioBytes.byteLength < 100) {
      throw new Error(`${runtimeLabel} returned empty audio.`);
    }
    return await ctx.decodeAudioData(audioBytes);
  };

  const enforceWordLimit = (candidateText: string) => {
    if (!primaryEngine) return;
    const preflight = preflightWordLimit(candidateText, MAX_WORDS_PER_REQUEST);
    if (!preflight.ok) {
      throw new Error(
        `TTS word limit exceeded (${preflight.wordCount}/${preflight.maxWords}). ` +
        `Split text or reduce length to ${preflight.maxWords} words.`
      );
    }
  };

  const maybeSynthesizePrimaryLongText = async (
    engine: 'GEM' | 'KOKORO',
    candidateText: string,
    synthesizeChunk: (
      chunkText: string,
      attempt: number,
      chunkIndex: number,
      chunkTotal: number
    ) => Promise<AudioBuffer>
  ): Promise<AudioBuffer | null> => {
    const profile = getChunkProfile(engine, lang);

    const windowWordLimit = MAX_WORDS_PER_WINDOW;
    const windows = buildSentenceAlignedWordWindows(candidateText, windowWordLimit);
    if (windows.length <= 1 && candidateText.length <= profile.targetCharCap) {
      return null;
    }

    const windowQueue = windows.length > 0
      ? windows
      : [{ index: 0, text: candidateText, charCount: candidateText.length, wordCount: countWords(candidateText) }];
    const windowTotal = windowQueue.length;
    const buffers: AudioBuffer[] = [];
    for (let windowIndex = 0; windowIndex < windowQueue.length; windowIndex += 1) {
      const windowChunk = windowQueue[windowIndex];
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= RETRY_ATTEMPTS_PER_CHUNK; attempt += 1) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
          const buffer = await synthesizeChunk(windowChunk.text, attempt, windowIndex, windowTotal);
          buffers.push(buffer);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const detail = error instanceof Error ? error.message : String(error);
          if (isKnownGeminiPoolMisconfigError(detail)) {
            break;
          }
          if (attempt < RETRY_ATTEMPTS_PER_CHUNK) {
            const backoff = RETRY_BACKOFF_MS[Math.min(RETRY_BACKOFF_MS.length - 1, attempt - 1)] || 0;
            await sleepMs(backoff);
          }
        }
      }
      if (lastError) {
        const detail = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(
          `Long-text synthesis failed (trace_id=${traceId}, window_index=${windowIndex + 1}, ` +
          `window_total=${windowTotal}): ${detail}`
        );
      }
    }

    return mergeChunkBuffersWithCrossfade(ctx, buffers, profile.joinCrossfadeMs);
  };
  
  // Load cloned voices
  let availableClones: ClonedVoice[] = [];
  try { 
    availableClones = JSON.parse(localStorage.getItem('vf_clones') || '[]'); 
  } catch (e) {}

  const resolveGeminiVoiceName = (candidate: string | undefined, fallback = 'Fenrir'): string => {
    let resolved = String(candidate || '').trim();
    if (!resolved) resolved = fallback;

    const matchedVoice =
      VOICES.find((voice) => (
        voice.id === resolved ||
        voice.name === resolved ||
        voice.geminiVoiceName === resolved
      )) ||
      availableClones.find((voice) => (
        voice.id === resolved ||
        voice.name === resolved ||
        voice.geminiVoiceName === resolved
      ));
    if (matchedVoice) {
      resolved = String(matchedVoice.geminiVoiceName || matchedVoice.id || matchedVoice.name || '').trim() || fallback;
    }

    const validVoice = VALID_VOICE_NAMES.find((voice) => voice.toLowerCase() === resolved.toLowerCase());
    return validVoice || fallback;
  };

  const resolveGeminiVoiceForSpeaker = (speaker: string, fallbackVoice: string): string => {
    const mappedId = settings.speakerMapping?.[speaker];
    if (mappedId) {
      return resolveGeminiVoiceName(mappedId, fallbackVoice);
    }

    const detectedGender = guessGenderFromName(speaker);
    const isHindiTarget = lang.startsWith('hi');
    let candidateVoices = VOICES.filter((voice) => (
      !isHindiTarget || /indian|hindi|india/i.test(`${voice.accent} ${voice.country || ''}`)
    ));
    if (candidateVoices.length === 0) candidateVoices = VOICES;

    if (detectedGender !== 'Unknown') {
      const genderVoices = candidateVoices.filter((voice) => voice.gender === detectedGender);
      if (genderVoices.length > 0) candidateVoices = genderVoices;
    }
    if (candidateVoices.length === 0) return fallbackVoice;

    let hash = 0;
    for (let i = 0; i < speaker.length; i += 1) {
      hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
    }
    const selected = candidateVoices[Math.abs(hash) % candidateVoices.length];
    return resolveGeminiVoiceName(selected?.id || fallbackVoice, fallbackVoice);
  };

  const ensureDistinctGeminiVoices = (voices: string[], fallbackVoice: string): string[] => {
    if (voices.length !== 2) return voices;
    if (voices[0].toLowerCase() !== voices[1].toLowerCase()) return voices;
    const alternate = VOICES
      .map((voice) => resolveGeminiVoiceName(voice.id, fallbackVoice))
      .find((voice) => voice.toLowerCase() !== voices[0].toLowerCase());
    if (!alternate) return voices;
    return [voices[0], alternate];
  };
  
  // Parse for multi-speaker and SFX content.
  // Gemini stays single-pass for plain text, but enables segmented mode for real multi-speaker scripts.
  const multiSpeakerEnabled = settings.multiSpeakerEnabled !== false;
  const studioSegments = parseStudioDialogue(text);
  const hasSfx = studioSegments.some((s) => s.isSfx);
  const { isMultiSpeaker, speakersList } = parseMultiSpeakerScript(text);
  const explicitSpeakerSet = new Set(
    speakersList
      .map((speaker) => String(speaker || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const hasTrueMultiSpeakerScript = multiSpeakerEnabled && isMultiSpeaker && speakersList.length > 1;
  const defaultGeminiVoice = resolveGeminiVoiceName(voiceName || settings.voiceId || 'Fenrir', 'Fenrir');
  const geminiStudioPairGroupsPlan = (() => {
    if (activeEngine !== 'GEM') return null;
    if (!multiSpeakerEnabled) return null;
    if (!hasTrueMultiSpeakerScript || hasSfx) return null;

    const speechSegments = studioSegments.filter((segment) => (
      !segment.isSfx &&
      Boolean(segment.speaker) &&
      Boolean(String(segment.text || '').trim())
    ));
    if (speechSegments.length === 0) return null;

    const speakerOrder: string[] = [];
    const seenSpeakers = new Set<string>();
    for (const segment of speechSegments) {
      const speaker = String(segment.speaker || '').trim();
      if (!speaker) continue;
      const key = speaker.toLowerCase();
      if (seenSpeakers.has(key)) continue;
      seenSpeakers.add(key);
      speakerOrder.push(speaker);
    }

    if (speakerOrder.length < 2) return null;

    const initialVoices = speakerOrder.map((speaker) => resolveGeminiVoiceForSpeaker(speaker, defaultGeminiVoice));
    const resolvedVoices = speakerOrder.length === 2
      ? ensureDistinctGeminiVoices(initialVoices, defaultGeminiVoice)
      : initialVoices;
    const speakerVoices = speakerOrder.map((speaker, index) => ({
      speaker,
      voiceName: resolvedVoices[index] || defaultGeminiVoice,
    }));
    const lineMap = speechSegments
      .map((segment) => {
        const speaker = String(segment.speaker || '').trim();
        const dialogue = String(segment.text || '').trim();
        if (!speaker || !dialogue) return null;
        const emotionCue =
          segment.emotion && segment.emotion !== 'Neutral'
            ? `(Tone: ${segment.emotion}) `
            : '';
        return {
          lineIndex: 0,
          speaker,
          text: `${emotionCue}${dialogue}`.trim(),
        };
      })
      .filter((item): item is { lineIndex: number; speaker: string; text: string } => Boolean(item && item.speaker && item.text))
      .map((item, index) => ({ ...item, lineIndex: index }));
    if (lineMap.length < 2) return null;

    const scriptText = lineMap
      .map((item) => `${item.speaker}: ${item.text}`)
      .join('\n')
      .trim();
    if (!scriptText) return null;

    return {
      scriptText,
      speakerVoices,
      lineMap,
    };
  })();
  const useGeminiBuiltInMultiSpeaker = Boolean(geminiStudioPairGroupsPlan);
  if (primaryEngine && !(useGeminiBuiltInMultiSpeaker && activeEngine === 'GEM')) {
    const totalSpeechText = studioSegments
      .filter((segment) => !segment.isSfx)
      .map((segment) => cleanText(segment.text))
      .filter(Boolean)
      .join(' ')
      .trim();
    enforceWordLimit(totalSpeechText || cleanText(text));
  }
  
  const useSegmentedGeneration = hasSfx || (
    multiSpeakerEnabled && (
      activeEngine === 'GEM'
        ? (hasTrueMultiSpeakerScript && !useGeminiBuiltInMultiSpeaker)
        : (
          (isMultiSpeaker && speakersList.length > 0) ||
          activeEngine === 'COQ' ||
          activeEngine === 'OPENAI' ||
          activeEngine === 'F5' ||
          (activeEngine === 'KOKORO' ? hasTrueMultiSpeakerScript : studioSegments.length > 1)
        )
    )
  );
  
  const synthesizeViaSegmentedGeneration = async (): Promise<AudioBuffer> => {
    const validSegments = studioSegments
      .map((s, i) => ({ ...s, originalIndex: i }))
      .filter(s => s.text.trim() || s.isSfx);
    
    const segmentResults: { index: number, buffer: AudioBuffer }[] = [];
    const autoSpeakerVoiceCache = new Map<string, { voiceId: string; voiceName: string }>();
    const BATCH_SIZE = activeEngine === 'KOKORO' ? 1 : 2;
    
    for (let i = 0; i < validSegments.length; i += BATCH_SIZE) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      
      const batch = validSegments.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (seg) => {
        if (signal?.aborted) return;
        
        try {
          const speakerName = String(seg.speaker || '').trim();
          const speakerKey = speakerName.toLowerCase();
          const hasExplicitSpeaker = Boolean(speakerKey) && explicitSpeakerSet.has(speakerKey);
          const allowAutoSpeakerRouting = hasExplicitSpeaker && hasTrueMultiSpeakerScript;

          // Handle SFX
          if (seg.isSfx) {
            const sfxItem = resolveSfxItem(seg.text);
            if (sfxItem) {
              try {
                const buffer = await fetchAudioBuffer(sfxItem.url);
                segmentResults.push({ index: seg.originalIndex, buffer });
                return;
              } catch (error) {
                console.warn(`Failed to load SFX asset "${sfxItem.id}", using procedural fallback.`, error);
              }
            }
            segmentResults.push({
              index: seg.originalIndex,
              buffer: createProceduralSfxBuffer(ctx, seg.text),
            });
            return;
          }
          
          // Determine effective voice for this segment
          let effectiveVoiceId = settings.voiceId || voiceName;
          let effectiveVoiceName = voiceName;
          let effectiveSpeed = settings.speed;
          
          if (hasExplicitSpeaker) {
            if (settings.speakerMapping && settings.speakerMapping[speakerName]) {
               const mappedId = settings.speakerMapping[speakerName];
               if (activeEngine === 'KOKORO' && runtimeVoiceCatalog.length > 0) {
                 const validIds = new Set(runtimeVoiceCatalog.map((voice) => voice.id));
                 effectiveVoiceId = validIds.has(mappedId) ? mappedId : runtimeVoiceCatalog[0].id;
               } else {
                 effectiveVoiceId = mappedId;
               }

               if (activeEngine === 'GEM') {
                 const v = VOICES.find(x => x.id === mappedId) || availableClones.find(x => x.id === mappedId);
                 if (v) {
                   effectiveVoiceName = v.geminiVoiceName || v.name;
                 } else {
                   effectiveVoiceName = 'Fenrir';
                 }
               } else {
                 effectiveVoiceName = mappedId;
               }
            } else if (allowAutoSpeakerRouting) {
               const cacheKey = `${activeEngine}:${lang}:${speakerName.toLowerCase()}`;
               const cached = autoSpeakerVoiceCache.get(cacheKey);
               if (cached) {
                 effectiveVoiceId = cached.voiceId;
                 effectiveVoiceName = cached.voiceName;
               } else {
               // SMART FALLBACK: Auto-Assign Voice based on Gender Heuristic
               // If no mapping exists, we don't just want default 'Fenrir'. 
               // We want to consistently pick a Male/Female voice based on name.
               
               const detectedGender = guessGenderFromName(speakerName);
               
               // Select Candidate Pool based on Engine
               let candidates: any[] = [];
               if (activeEngine === 'OPENAI') candidates = OPENAI_VOICES;
               else if (activeEngine === 'F5') candidates = F5_VOICES;
               else if (activeEngine === 'KOKORO') candidates = runtimeVoiceCatalog.length > 0 ? runtimeVoiceCatalog : KOKORO_VOICES;
               else candidates = VOICES;

               if (activeEngine === 'KOKORO') {
                 const isHindiTarget = lang.startsWith('hi');
                 const hindiCandidates = candidates.filter((v) => /hindi|india|^hf_|^hm_|_hi_/i.test(`${v.id} ${v.accent} ${v.country || ''}`));
                 const englishCandidates = candidates.filter((v) => !/hindi|india|^hf_|^hm_|_hi_/i.test(`${v.id} ${v.accent} ${v.country || ''}`));
                 if (isHindiTarget && hindiCandidates.length > 0) candidates = hindiCandidates;
                 if (!isHindiTarget && englishCandidates.length > 0) candidates = englishCandidates;
               }

               if (candidates.length === 0) {
                 if (activeEngine === 'KOKORO') candidates = KOKORO_VOICES;
                 else candidates = VOICES;
               }

               // Filter by gender if known, otherwise use all
               let genderCandidates = candidates.filter(v => v.gender === detectedGender);
               if (genderCandidates.length === 0) genderCandidates = candidates;
               if (genderCandidates.length === 0) {
                 effectiveVoiceId = settings.voiceId || voiceName;
                 effectiveVoiceName = effectiveVoiceId;
               }

               // Hash the name to consistently pick the same voice for the same name
               if (genderCandidates.length > 0) {
                 let hash = 0;
                 for (let c = 0; c < speakerName.length; c++) hash = speakerName.charCodeAt(c) + ((hash << 5) - hash);
                 const idx = Math.abs(hash) % genderCandidates.length;
                 
                 const selectedVoice = genderCandidates[idx];
                 if (selectedVoice) {
                     effectiveVoiceId = selectedVoice.id;
                      if (activeEngine === 'GEM') effectiveVoiceName = selectedVoice.geminiVoiceName || selectedVoice.id;
                      else effectiveVoiceName = selectedVoice.id;
                  }
               }
               autoSpeakerVoiceCache.set(cacheKey, {
                 voiceId: String(effectiveVoiceId || ''),
                 voiceName: String(effectiveVoiceName || effectiveVoiceId || ''),
               });
              }
             }
          }
          
          // Inject Emotion into text for models that support context
          // For Gemini 2.5, we prepend the emotion/tone to the text if it's significant
          const baseEmotion =
            normalizeEmotionTag(String(settings.emotion || '')) ||
            settings.emotion ||
            'Neutral';
          const normalizedSegmentEmotion = hasExplicitSpeaker
            ? (
              normalizeEmotionTag(String(seg.emotion || '')) ||
              seg.emotion ||
              baseEmotion
            )
            : baseEmotion;

          let textToGen = seg.text;
          if (normalizedSegmentEmotion !== 'Neutral' && activeEngine === 'GEM') {
               textToGen = `(Tone: ${normalizedSegmentEmotion}) ${seg.text}`;
           }
          
          // Create segment-specific settings
          const segSettings = { 
            ...settings, 
            chatterboxId: effectiveVoiceId, 
            voiceId: effectiveVoiceId,
            emotion: normalizedSegmentEmotion,
            speed: effectiveSpeed,
            runtimeSpeakerHint: speakerName || undefined,
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
          if (primaryEngine) throw e;
          
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
  };

  // --- BATCH PROCESSING FOR MULTI-SPEAKER ---
  if (useSegmentedGeneration) {
    return await synthesizeViaSegmentedGeneration();
  }

  const processedText = useGeminiBuiltInMultiSpeaker
    ? String(geminiStudioPairGroupsPlan?.scriptText || '').trim()
    : cleanText(text);
  if (!processedText) {
    throw new Error("Input text is empty after processing.");
  }
  enforceWordLimit(processedText);

  // --- LOCAL GEMINI RUNTIME ---
  if (activeEngine === 'GEM') {
    const runtimeUrl = normalizeRuntimeUrl(settings.geminiTtsServiceUrl, 'http://127.0.0.1:7810');
    const targetVoiceName = defaultGeminiVoice;
    const speakerHint = String(runtimeSettings.runtimeSpeakerHint || '').trim();

    try {
      const normalizedRequest = normalizeSynthesisRequest({
        engine: 'GEM',
        text: processedText,
        voiceId: targetVoiceName,
        language: lang,
        speed: settings.speed,
        emotion: settings.emotion,
        style: settings.style,
        traceId,
      });
      return await synthesizeViaBackendGateway(
        'GEM',
        runtimeUrl,
        '/synthesize',
        {
          text: useGeminiBuiltInMultiSpeaker ? processedText : normalizedRequest.text,
          voiceName: targetVoiceName,
          voice_id: normalizedRequest.voice_id,
          language: normalizedRequest.language,
          speaker_voices: geminiStudioPairGroupsPlan?.speakerVoices,
          multi_speaker_mode: useGeminiBuiltInMultiSpeaker ? 'studio_pair_groups' : undefined,
          multi_speaker_max_concurrency: useGeminiBuiltInMultiSpeaker ? 7 : undefined,
          multi_speaker_retry_once: useGeminiBuiltInMultiSpeaker ? true : undefined,
          multi_speaker_line_map: useGeminiBuiltInMultiSpeaker
            ? geminiStudioPairGroupsPlan?.lineMap.map((line) => ({
                lineIndex: line.lineIndex,
                speaker: line.speaker,
                text: line.text,
              }))
            : undefined,
          speed: normalizedRequest.speed,
          emotion: normalizedRequest.emotion,
          style: normalizedRequest.style,
          trace_id: normalizedRequest.trace_id,
          speaker: speakerHint || undefined,
          apiKey: resolveGeminiApiKey(settings) || undefined,
        },
        'Gemini runtime synthesis'
      );
    } catch (runtimeError: any) {
      let finalRuntimeError: any = runtimeError;
      if (useGeminiBuiltInMultiSpeaker) {
        try {
          console.warn(
            'Gemini grouped multi-speaker synthesis failed; falling back to segmented mode.',
            runtimeError
          );
          return await synthesizeViaSegmentedGeneration();
        } catch (fallbackError: any) {
          finalRuntimeError = fallbackError;
          console.warn('Gemini segmented fallback failed after grouped mode error.', fallbackError);
        }
      }
      if (!allowPersonalGeminiBypass) {
        throw finalRuntimeError;
      }
      const configuredApiKey = resolveGeminiApiKey(settings);
      if (!configuredApiKey) {
        throw new Error("Personal Gemini key mode is enabled, but API key is missing.");
      }
      console.warn('Gemini runtime synthesis failed; personal-key mode enabled, switching to direct Gemini API.', finalRuntimeError);
    }
  }

  // --- KOKORO RUNTIME ---
  if (activeEngine === 'KOKORO') {
    const runtimeUrl = normalizeRuntimeUrl(settings.kokoroTtsServiceUrl, 'http://127.0.0.1:7820');
    const targetVoiceId = String(settings.voiceId || voiceName || 'hf_alpha').trim() || 'hf_alpha';
    const synthKokoroChunk = async (chunkText: string, attempt: number): Promise<AudioBuffer> => {
      const attemptSpeed = attempt > 1 ? 1.0 : settings.speed;
      const attemptEmotion = attempt >= 3 ? undefined : settings.emotion;
      const attemptStyle = attempt >= 3 ? undefined : settings.style;
      const normalizedRequest = normalizeSynthesisRequest({
        engine: 'KOKORO',
        text: chunkText,
        voiceId: targetVoiceId,
        language: lang,
        speed: attemptSpeed,
        emotion: attemptEmotion,
        style: attemptStyle,
        traceId,
      });
      return await synthesizeViaBackendGateway(
        'KOKORO',
        runtimeUrl,
        '/synthesize',
        {
          text: normalizedRequest.text,
          voiceId: normalizedRequest.voice_id,
          voice_id: normalizedRequest.voice_id,
          language: normalizedRequest.language,
          speed: normalizedRequest.speed,
          emotion: normalizedRequest.emotion,
          style: normalizedRequest.style,
          trace_id: normalizedRequest.trace_id,
        },
        'Kokoro runtime synthesis'
      );
    };

    const longTextBuffer = await maybeSynthesizePrimaryLongText(
      'KOKORO',
      processedText,
      async (chunkText, attempt) => synthKokoroChunk(chunkText, attempt)
    );
    if (longTextBuffer) return longTextBuffer;
    return await synthKokoroChunk(processedText, 1);
  }

  // --- F5-TTS ENGINE (BACKEND) ---
  if (activeEngine === 'F5') {
      if (!runtimeSettings.backendUrl) throw new Error("Backend URL is required for F5-TTS.");
      
      try {
          let url = runtimeSettings.backendUrl.replace(/\/$/, '');
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
              model: runtimeSettings.f5Model || 'f5-tts',
              input: processedText,
              voice: voicePayload,
              speed: settings.speed || 1.0,
              response_format: 'pcm', // Request raw PCM if supported for optimization
          };

          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'ngrok-skip-browser-warning': 'true',
              ...optionalBearerAuthHeaders(runtimeSettings.backendApiKey),
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
          if (runtimeSettings.enableWebGpu && arrayBuffer.byteLength % 2 === 0) {
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
  if (activeEngine === 'OPENAI') {
    if (!runtimeSettings.backendUrl) throw new Error("Backend URL is required for OpenAI/Local engine.");
    
    try {
      let url = runtimeSettings.backendUrl.replace(/\/$/, '');
      if (!url.includes('/v1/audio/speech')) url += '/v1/audio/speech';
      
      const modelName = runtimeSettings.openaiModel || 'openedai-speech-bilingual-tts-1';
      
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
          'ngrok-skip-browser-warning': 'true',
          ...optionalBearerAuthHeaders(runtimeSettings.backendApiKey),
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
  if (activeEngine === 'COQ') {
    if (!runtimeSettings.backendUrl) throw new Error("Backend URL is required for Coqui.");
    
    try {
      let url = runtimeSettings.backendUrl.replace(/\/$/, '');
      if (!url.endsWith('/tts') && !url.endsWith('/api/tts')) url += '/tts';
      
      let speakerId = voiceName;
      
      // If voiceName is a Gemini name (or present in our list of known Gemini voices), 
      // we should prefer the stored Chatterbox ID if available, unless speakerId is explicitly set.
      const isGeminiName = VOICES.some(v => v.geminiVoiceName === voiceName || v.id === voiceName) || VALID_VOICE_NAMES.includes(voiceName.toLowerCase());
      
      if (!speakerId || isGeminiName) {
        speakerId = runtimeSettings.chatterboxId || settings.voiceId || '';
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
  if (!allowPersonalGeminiBypass) {
    throw new Error('Gemini direct API bypass is disabled. Enable personal key mode to bypass runtime.');
  }
  const geminiKey = resolveGeminiApiKey(settings);
  if (!geminiKey) throw new Error("API Key is missing for Gemini TTS.");
  
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  
  try {
    const targetVoice = defaultGeminiVoice;
    const textToSpeak = processedText;
    const directGeminiMultiSpeaker =
      useGeminiBuiltInMultiSpeaker &&
      geminiStudioPairGroupsPlan &&
      geminiStudioPairGroupsPlan.speakerVoices.length === 2
        ? geminiStudioPairGroupsPlan.speakerVoices
        : null;
    const ttsModelsToTry = await getGeminiModelCandidates(
      ai,
      geminiKey,
      'tts',
      TTS_MODELS_FALLBACK
    );
    
    let lastError: any = null;
    
    for (const model of ttsModelsToTry) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: [{ parts: [{ text: textToSpeak }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: directGeminiMultiSpeaker
              ? {
                languageCode: lang,
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs: directGeminiMultiSpeaker.map((entry) => ({
                    speaker: entry.speaker,
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: entry.voiceName,
                      },
                    },
                  })),
                },
              }
              : {
                languageCode: lang,
                voiceConfig: { 
                  prebuiltVoiceConfig: { voiceName: targetVoice } 
                },
              },
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

