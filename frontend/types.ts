export enum AppScreen {
  ONBOARDING = 'ONBOARDING',
  LOGIN = 'LOGIN',
  MAIN = 'MAIN',
  PROFILE = 'PROFILE',
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Male' | 'Female' | 'Unknown';
  accent: string;
  geminiVoiceName: string;
  country?: string;
  ageGroup?: string;
  engine?: 'GEM' | 'KOKORO';
  source?: string;
  isDownloaded?: boolean;
  isCloned?: boolean;
  previewUrl?: string;
}

export interface ClonedVoice extends VoiceOption {
  originalSampleUrl: string;
  dateCreated: number;
  description: string;
  referenceText?: string;
}

export interface RemoteSpeaker {
  id: string;
  name: string;
}

export interface VoiceSampleAnalysis {
  description: string;
  emotionHint?: {
    emotion: string;
    style?: string | undefined;
    emotionRefId?: string | undefined;
    confidence?: number | undefined;
    nonLinguistic?: boolean | undefined;
  };
}

export interface MusicTrack {
  id: string;
  name: string;
  url: string;
  category:
    | 'Calm'
    | 'Cinematic'
    | 'Upbeat'
    | 'Lo-Fi'
    | 'None'
    | 'Electronic'
    | 'Jazz'
    | 'Classical'
    | 'World'
    | 'Ambient'
    | 'Comedy'
    | 'Horror'
    | 'Romantic';
}

export interface SoundEffect {
  id: string;
  name: string;
  category: string;
  duration: number;
  url: string;
  tags: string[];
  description?: string;
}

export interface GenerationSettings {
  voiceId: string;
  speed: number;
  pitch: 'Low' | 'Medium' | 'High';
  language: string;
  emotion?: string | undefined;
  style?: string | undefined;
  emotionRefId?: string | undefined;
  emotionStrength?: number | undefined;

  // TTS engine (two-engine contract only)
  engine: 'GEM' | 'KOKORO';

  // Assistant provider
  helperProvider: 'GEMINI' | 'PERPLEXITY' | 'LOCAL';
  assistantProviderControlsEnabled?: boolean | undefined;
  perplexityApiKey?: string | undefined;
  localLlmUrl?: string | undefined;
  geminiApiKey?: string | undefined;
  preferUserGeminiKey?: boolean | undefined;

  // Local backend / runtime wiring
  mediaBackendUrl?: string | undefined;
  backendApiKey?: string | undefined;
  rvcModel?: string | undefined;
  conversionPolicy?: 'AUTO_RELIABLE' | 'LHQ_PILOT' | undefined;
  geminiTtsServiceUrl?: string | undefined;
  kokoroTtsServiceUrl?: string | undefined;

  // Studio controls
  musicTrackId?: string | undefined;
  musicVolume?: number | undefined;
  speechVolume?: number | undefined;
  autoEnhance?: boolean | undefined;
  multiSpeakerEnabled?: boolean | undefined;
  speakerMapping?: Record<string, string> | undefined;

  // Dubbing options
  useModelSourceSeparation?: boolean | undefined;
  preserveDubVoiceTone?: boolean | undefined;
  dubbingSourceLanguage?: string | undefined;
}

export type ScriptBlockType = 'dialogue' | 'sfx' | 'direction';
export type StudioEditorMode = 'blocks' | 'raw';

export interface ScriptBlockEmotionMeta {
  primaryEmotion: string;
  cueTags: string[];
}

export interface ScriptBlock {
  id: string;
  type: ScriptBlockType;
  speaker: string;
  text: string;
  emotion: ScriptBlockEmotionMeta;
}

export interface DriveConnectionState {
  status:
    | 'checking'
    | 'connected'
    | 'guest'
    | 'needs_google_identity'
    | 'needs_consent'
    | 'needs_login'
    | 'error';
  message: string;
}

export interface NovelProject {
  id: string;
  name: string;
  rootFolderId: string;
  exportsFolderId?: string | undefined;
  createdTime?: string | undefined;
  modifiedTime?: string | undefined;
}

export interface NovelChapter {
  id: string;
  projectId: string;
  title: string;
  name: string;
  index: number;
  createdTime?: string | undefined;
  modifiedTime?: string | undefined;
}

export type MemoryEntryKind = 'character' | 'place';

export interface MemoryEntry {
  id: string;
  kind: MemoryEntryKind;
  sourceName: string;
  adaptedName: string;
  locked: boolean;
  confidence?: number | undefined;
  notes?: string | undefined;
  updatedAt: string;
}

export interface ProjectMemoryLedger {
  characters: MemoryEntry[];
  places: MemoryEntry[];
  chapterSummaries?: ChapterMemorySummary[];
}

export interface ChapterMemorySummary {
  chapterId: string;
  chapterTitle: string;
  summary: string;
  newCharacters: string[];
  newPlaces: string[];
  updatedAt: string;
}

export interface ChapterVersionSnapshot {
  id: string;
  chapterId: string;
  timestamp: string;
  sourceText: string;
  adaptedText: string;
  label: string;
  reason?: string;
}

export type ChapterAdaptationStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';

export interface ChapterAdaptationState {
  chapterId: string;
  status: ChapterAdaptationStatus;
  lastAdaptedAt?: string;
  error?: string;
}

export interface NovelImportExtractDiagnostics {
  mode: 'txt' | 'pdf_text' | 'image_ai' | 'pdf_ai_fallback';
  warnings: string[];
  usedAiFallback: boolean;
}

export interface NovelImportPageStat {
  page: number;
  chars: number;
}

export interface NovelImportChapterPreview {
  title: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

export type NovelIdeaSource = 'webnovel' | 'pocketnovel';

export interface NovelIdeaCard {
  id: string;
  title: string;
  premise: string;
  hook: string;
  conflict: string;
  twist: string;
  tone?: string;
  openingLine?: string;
}

export interface NovelConversionJob {
  id: string;
  type: 'chapter_to_pdf' | 'docx_to_pdf' | 'pdf_to_docx';
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  startedAt: number;
  completedAt?: number;
}

export interface NovelConversionResult {
  job: NovelConversionJob;
  outputFileName: string;
  driveFileId?: string;
  warnings?: string[];
}

export interface Draft {
  id: string;
  name: string;
  text: string;
  settings: GenerationSettings;
  lastModified: number;
}

export interface CharacterProfile {
  id: string;
  name: string;
  voiceId: string;
  gender?: 'Male' | 'Female' | 'Unknown';
  age?: string;
  avatarColor?: string;
  description?: string;
}

export interface DubSegment {
  id: string;
  startTime: number;
  endTime: number;
  speaker: string;
  text: string;
  translatedText: string;
  emotion: string;
  gender: 'Male' | 'Female' | 'Unknown';
  age: string;
  audioUrl?: string;
  originalAudioUrl?: string;
}

export interface DirectorAnalysis {
  segments: DubSegment[];
  sceneMood: string;
  detectedCharacters: CharacterProfile[];
}

export interface VfEngineUsage {
  chars: number;
  vf: number;
}

export interface VfUsageWindow {
  key: string;
  totalChars: number;
  totalVf: number;
  byEngine: Record<GenerationSettings['engine'], VfEngineUsage>;
}

export interface VfUsageStats {
  unit: 'VF';
  rates: Record<GenerationSettings['engine'], number>;
  daily: VfUsageWindow;
  monthly: VfUsageWindow;
  lifetime: VfUsageWindow;
  lastRecordedAt?: number | undefined;
}

export interface UserWalletStats {
  monthlyFreeRemaining: number;
  monthlyFreeLimit: number;
  vffBalance: number;
  paidVfBalance: number;
  spendableNowByEngine: Record<GenerationSettings['engine'], number>;
  adClaimsToday: number;
  adClaimsDailyLimit: number;
  vffMonthKey?: string | undefined;
}

export interface UserStats {
  generationsUsed: number;
  generationsLimit: number;
  isPremium: boolean;
  planName: 'Free' | 'Pro' | 'Plus' | 'Enterprise';
  lastResetDate?: string | undefined;
  vfUsage: VfUsageStats;
  wallet: UserWalletStats;
}

export interface UserProfile {
  googleId: string;
  name: string;
  email: string;
  avatarUrl?: string | undefined;
  username?: string | undefined;
  role?: 'user' | 'admin' | undefined;
  isAdmin?: boolean | undefined;
  uid?: string | undefined;
  phoneNumber?: string | undefined;
  providers?: string[] | undefined;
}

export interface HistoryItem {
  id: string;
  text: string;
  audioUrl?: string | undefined;
  voiceName: string;
  timestamp: number;
  duration?: string | undefined;
  engine?: 'GEM' | 'KOKORO' | undefined;
  chars?: number | undefined;
  requestId?: string | undefined;
  traceId?: string | undefined;
  status?: 'completed' | 'failed' | 'cancelled' | string | undefined;
}

export interface UserContextType {
  user: UserProfile;
  updateUser: (u: Partial<UserProfile>) => void;
  stats: UserStats;
  updateStats: (newStats: Partial<UserStats>) => void;
  history: HistoryItem[];
  loadHistory: (limit?: number) => Promise<void>;
  addToHistory: (item: HistoryItem) => void;
  clearHistory: () => Promise<void>;
  deleteAccount: () => void;
  clonedVoices: ClonedVoice[];
  addClonedVoice: (voice: ClonedVoice) => void;
  drafts: Draft[];
  saveDraft: (name: string, text: string, settings: GenerationSettings) => void;
  deleteDraft: (id: string) => void;
  showSubscriptionModal: boolean;
  setShowSubscriptionModal: (show: boolean) => void;
  watchAd: () => Promise<void>;
  recordTtsUsage: (engine: GenerationSettings['engine'], charCount: number) => void;

  characterLibrary: CharacterProfile[];
  updateCharacter: (character: CharacterProfile) => void;
  deleteCharacter: (id: string) => void;
  getVoiceForCharacter: (name: string) => string | undefined;

  signInWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>;
  signOutUser: () => Promise<void>;
  signInWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  signInWithFacebook: () => Promise<{ ok: boolean; error?: string }>;
  startPhoneSignIn: (
    phoneNumber: string,
    recaptchaContainerId: string
  ) => Promise<{ ok: boolean; error?: string }>;
  confirmPhoneSignIn: (code: string) => Promise<{ ok: boolean; error?: string }>;
  loginAsGuest: () => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasUnlimitedAccess: boolean;
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
}

export interface RuntimeCapabilities {
  engine: GenerationSettings['engine'];
  runtime: string;
  ready: boolean;
  languages: string[];
  speed: {
    min: number;
    max: number;
    default: number;
  };
  supportsEmotion: boolean;
  supportsStyle: boolean;
  supportsSpeakerWav: boolean;
  model?: string | undefined;
  voiceCount?: number | undefined;
  emotionCount?: number | undefined;
  displayName?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface SynthesisTrace {
  traceId: string;
  engine: GenerationSettings['engine'];
  state: 'idle' | 'preparing' | 'synthesizing' | 'mixing' | 'completed' | 'failed' | 'cancelled';
  stage?: string | undefined;
  startedAt: number;
  updatedAt: number;
  detail?: string | undefined;
}

export interface NormalizedSynthesisRequest {
  text: string;
  voice_id: string;
  language: string;
  speed: number;
  emotion?: string | undefined;
  style?: string | undefined;
  trace_id?: string | undefined;
}

export interface DubbingSegment {
  id?: string;
  startTime: number;
  endTime?: number | undefined;
  speaker: string;
  text: string;
  emotion?: string | undefined;
  crewTags?: string[] | undefined;
  emotionTags?: string[] | undefined;
}

export interface DubbingJobRequest {
  sourceFile: File;
  targetLanguage: string;
  engine: GenerationSettings['engine'];
  voiceMap?: Record<string, string>;
  transcript?: string;
  emotionMatching?: boolean;
  prosodyTransfer?: boolean;
  lipSync?: boolean;
  output?: 'audio' | 'video' | 'audio+video';
}

export interface DubbingJobRequestV2 {
  sourceFile: File;
  targetLanguage: string;
  mode?: 'strict_full' | 'fast';
  output?: 'audio' | 'video' | 'audio+video';
  advanced?: Record<string, unknown>;
}

export interface DubbingSpeakerProfile {
  speaker: string;
  voiceId?: string;
}

export interface DubbingJobStatus {
  jobId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'idle';
  progress?: number;
  stage?: string;
  error?: string;
  pipelineVersion?: 'v1' | 'v2';
  speakerProfiles?: DubbingSpeakerProfile[];
}

export interface DubbingReport {
  jobId?: string;
  status?: string;
  summary?: Record<string, unknown>;
  [key: string]: unknown;
}
