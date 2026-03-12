export enum AppScreen {
  ONBOARDING = 'ONBOARDING',
  LOGIN = 'LOGIN',
  USER_ID_SETUP = 'USER_ID_SETUP',
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
  engine?: 'GEM' | 'NEURAL2' | 'KOKORO';
  source?: string;
  isDownloaded?: boolean;
  isCloned?: boolean;
  previewUrl?: string;
  accessTier?: 'free' | 'pro';
  isPlanRestricted?: boolean;
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

  // TTS engine
  engine: 'GEM' | 'NEURAL2' | 'KOKORO';

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
  voiceModel?: string | undefined;
  conversionPolicy?: 'AUTO_RELIABLE' | 'VOICE_TRANSFER_ONLY' | undefined;
  geminiTtsServiceUrl?: string | undefined;
  kokoroTtsServiceUrl?: string | undefined;
  kokoroStandbyIdleMs?: number | undefined;

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

  // Frontend UI preferences
  uiMotionLevel?: 'off' | 'balanced' | 'rich' | undefined;
  autoPlayGeneratedAudio?: boolean | undefined;
}

export type ScriptBlockType = 'dialogue' | 'sfx' | 'direction';
export type StudioEditorMode = 'blocks' | 'raw';
export type WorkspaceLayoutMode = 'phone' | 'tablet' | 'desktop';

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
  mode: 'txt' | 'pdf_text' | 'image_ai' | 'pdf_ai_fallback' | 'generic_text' | 'generic_ai';
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

export type StudioQueueItemStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StudioQueueItem {
  id: string;
  order: number;
  label: string;
  status: StudioQueueItemStatus;
  sourceText: string;
  charCount: number;
  jobId?: string | undefined;
  audioCacheKey?: string | undefined;
  error?: string | undefined;
  settingsSnapshot: GenerationSettings;
  createdAt: number;
  completedAt?: number | undefined;
}

export type StudioQueueMasterStatus = 'idle' | 'building' | 'ready';

export interface StudioQueueState {
  items: StudioQueueItem[];
  activeItemId?: string | undefined;
  masterOrder: string;
  masterStatus: StudioQueueMasterStatus;
  queueModeEnabled: boolean;
  sourceHash: string;
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
  isPremium: boolean;
  planName: 'Free' | 'Starter' | 'Creator' | 'Pro' | 'Scale' | 'Plus' | 'Enterprise';
  lastResetDate?: string | undefined;
  vfUsage: VfUsageStats;
  wallet: UserWalletStats;
  limits?: {
    maxCharsPerGeneration: number;
    allowedEngines: GenerationSettings['engine'][];
  };
  features?: {
    earlyAccess: boolean;
  };
}

export interface UserProfile {
  googleId: string;
  name: string;
  email: string;
  avatarUrl?: string | undefined;
  userId?: string | undefined;
  username?: string | undefined;
  role?: 'user' | 'admin' | undefined;
  isAdmin?: boolean | undefined;
  uid?: string | undefined;
  phoneNumber?: string | undefined;
  providers?: string[] | undefined;
  adminActor?: {
    uid?: string;
    userId?: string;
    role: string;
    status: string;
    permissions: string[];
    source?: string;
  } | null;
}

export interface HistoryItem {
  id: string;
  text: string;
  audioUrl?: string | undefined;
  voiceName: string;
  voiceId?: string | undefined;
  timestamp: number;
  duration?: string | undefined;
  engine?: 'GEM' | 'NEURAL2' | 'KOKORO' | undefined;
  chars?: number | undefined;
  requestId?: string | undefined;
  traceId?: string | undefined;
  status?: 'completed' | 'failed' | 'cancelled' | string | undefined;
}

export interface AuthActionResult {
  ok: boolean;
  error?: string;
}

export interface SignInActionResult extends AuthActionResult {
  requiresUserIdSetup?: boolean;
  requiresEmailVerification?: boolean;
  canResendVerification?: boolean;
}

export interface SignUpActionResult extends AuthActionResult {
  requiresEmailVerification?: boolean;
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

  signInWithEmail: (email: string, password: string) => Promise<SignInActionResult>;
  signUpWithEmail: (email: string, password: string, displayName?: string, userId?: string) => Promise<SignUpActionResult>;
  resendEmailVerification: (email: string, password: string) => Promise<AuthActionResult>;
  requestPasswordReset: (email: string) => Promise<AuthActionResult>;
  signOutUser: () => Promise<void>;
  signInWithGoogle: () => Promise<SignInActionResult>;
  signInWithFacebook: () => Promise<AuthActionResult>;
  startPhoneSignIn: (
    phoneNumber: string,
    recaptchaContainerId: string
  ) => Promise<AuthActionResult>;
  confirmPhoneSignIn: (code: string) => Promise<AuthActionResult>;
  loginAsGuest: () => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasUnlimitedAccess: boolean;
  refreshAdminActor?: () => Promise<void>;
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

export type DubbingClipLayer = 'V1' | 'V2';
export type DubbingClipStatus =
  | 'idle'
  | 'queued'
  | 'transcribing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CpuDubbingProfile = 'cpu_quality' | 'cpu_balanced' | 'cpu_fast';

export interface DubbingClip {
  id: string;
  file: File;
  objectUrl: string;
  durationMs: number;
  trimInMs: number;
  trimOutMs: number;
  layer: DubbingClipLayer;
  script: string;
  status: DubbingClipStatus;
  jobId?: string | undefined;
  resultUrl?: string | null | undefined;
  reportUrl?: string | null | undefined;
  error?: string | undefined;
}

export interface DubbingClipboard {
  clip: DubbingClip;
  copiedAt: number;
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
  pipelineVersion?: 'v1' | 'v2' | '2026.1' | string;
  stageTimeline?: Array<{
    stage:
      | 'acoustic_isolation'
      | 'speaker_segmentation'
      | 'translation'
      | 'tts'
      | 'voice_transfer'
      | 'video_lipsync'
      | string;
    status: string;
    startMs?: number | null;
    endMs?: number | null;
    durationMs?: number | null;
  }>;
  outputFiles?: Record<string, unknown>;
  directorJson?: Record<string, unknown> | null;
  isochronyStats?: Record<string, unknown> | null;
  voiceTransferMetrics?: Record<string, unknown> | null;
  videoSyncMetrics?: Record<string, unknown> | null;
  tokenUsage?: Record<string, unknown> | null;
  assets?: Record<string, unknown> | null;
  thinkingPolicy?: Record<string, unknown> | null;
  speakerProfiles?: DubbingSpeakerProfile[];
  live?: {
    enabled?: boolean;
    mode?: string;
    playableChunks?: number;
    playableDurationMs?: number;
    chunkCursorNext?: number;
  };
  chunks?: Array<{
    index: number;
    contentType?: string;
    durationMs?: number;
    speakerId?: string;
    engine?: string;
    voiceId?: string;
    textChars?: number;
    timelineStartMs?: number;
    timelineEndMs?: number;
    previewKind?: string;
    downloadUrl?: string;
    audioBase64?: string;
  }>;
  chunkCursorNext?: number;
  speakerStats?: {
    detectedSpeakers?: number;
    mappedSpeakers?: number;
    fallbackBindings?: Array<Record<string, unknown>>;
    driftAlerts?: Array<Record<string, unknown>>;
  };
  qosState?: {
    selectedProfile?: string;
    downgraded?: boolean;
    reason?: string;
    gpuUsed?: boolean;
  };
}

export interface DubbingReport {
  jobId?: string;
  status?: string;
  summary?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ReaderCatalogRegion {
  id: string;
  label: string;
  locale?: string;
  languageCodes?: string[];
  sharedCount?: number;
  emptyState?: string;
}

export interface ReaderCatalogItem {
  id: string;
  title: string;
  author: string;
  regionId: string;
  regionLabel?: string;
  sourceLanguage?: string;
  languageLabel?: string;
  contentKind: 'book' | 'comic';
  surface: 'books' | 'comics' | 'uploads';
  provider: string;
  license: string;
  sourceUrl?: string;
  summary?: string;
  excerpt?: string;
  sampleText?: string;
  contentUrl?: string;
  archiveTxtUrl?: string;
  coverUrl?: string;
  supportsReadHere?: boolean;
  ownershipBasis?: string;
  textPath?: string;
  manifestPath?: string;
  fileNames?: string[];
  direction?: string;
  readingModeDefault?: string;
  collectionLabel?: string;
  sessionId?: string;
  resume?: ReaderResumeState;
  readiness?: ReaderReadiness;
  prep?: ReaderPreparation;
  stats?: ReaderItemStats;
  translationSupport?: {
    page: boolean;
    tts: boolean;
  };
  commercialUseStatus?: 'allowed' | 'blocked' | 'review';
  commercialUseReason?: string | null;
  sourceMeta?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReaderResumeState {
  hasProgress: boolean;
  consumedChars: number;
  currentPanelIndex: number;
  progressPct: number;
  updatedAt?: string;
  sessionId?: string;
}

export interface ReaderReadiness {
  state: 'ready' | 'preparing' | 'blocked';
  label: string;
  playableItems: number;
  reason?: string;
}

export interface ReaderPreparation {
  state: 'queued' | 'running' | 'ready' | 'error' | 'degraded';
  stage: 'manifest' | 'assets' | 'ocr' | 'audio';
  completedItems: number;
  totalItems: number;
  failedItems: number;
  message?: string;
}

export interface ReaderItemStats {
  totalChars?: number;
  totalPanels?: number;
  pageCount?: number;
  fileCount?: number;
}

export interface ReaderLibrary {
  surface: 'all' | 'books' | 'comics' | 'uploads';
  regionId: string;
  regions: ReaderCatalogRegion[];
  commercialPolicyVersion?: string;
  blockedProviders?: string[];
  items: ReaderCatalogItem[];
  activeSession?: ReaderSession | null;
  activeSessions?: ReaderSession[];
  counts: {
    all: number;
    visible: number;
    books: number;
    comics: number;
    uploads: number;
    resumable: number;
  };
  facets: {
    providers: string[];
    collections: string[];
    progressStates: string[];
  };
  shelves: {
    continueReading: ReaderCatalogItem[];
    trending: ReaderCatalogItem[];
    newArrivals: ReaderCatalogItem[];
    recentlyImported: ReaderCatalogItem[];
  };
}

export interface ReaderVoiceCast {
  [speaker: string]: string;
}

export interface ReaderAudioWindow {
  index: number;
  startChar?: number;
  endChar?: number;
  charCount?: number;
  text?: string;
  sourceText?: string;
  translatedText?: string;
  displayText?: string;
  translationStatus?: 'pending' | 'ready' | 'error';
  estimatedReadMs?: number;
  textOverrideStatus?: 'none' | 'edited' | string;
  overrideText?: string;
  overrideUpdatedAt?: string;
  pacing?: {
    baseReadMs?: number;
    emotionAwareReadMs?: number;
    emotionMultiplier?: number;
    emotion?: string;
  };
  status?: string;
  purged?: boolean;
  exported?: boolean;
  jobId?: string;
  job?: {
    jobId?: string;
    status?: string;
    playableChunks?: number;
    playableDurationMs?: number;
    downloadUrl?: string;
  };
}

export interface ReaderPanelManifest {
  panelId: string;
  pageId: string;
  index: number;
  direction: string;
  text: string;
  sourceText?: string;
  translatedText?: string;
  displayText?: string;
  translationStatus?: 'pending' | 'ready' | 'error';
  estimatedReadMs?: number;
  textOverrideStatus?: 'none' | 'edited' | string;
  overrideText?: string;
  overrideUpdatedAt?: string;
  pacing?: {
    baseReadMs?: number;
    emotionAwareReadMs?: number;
    emotionMultiplier?: number;
    emotion?: string;
  };
  speaker?: string;
  emotion?: string;
  sfx?: string[];
  imagePath?: string;
  imageUrl?: string;
  audioJobId?: string;
  audioStatus?: string;
  purged?: boolean;
  audioJob?: {
    jobId?: string;
    status?: string;
    playableChunks?: number;
    playableDurationMs?: number;
    downloadUrl?: string;
  };
}

export type ReaderAudioEngine = 'tts_hd' | 'native_audio_dialog';
export type ReaderAudioEngineStatus = 'active' | 'fallback_to_tts' | 'unavailable' | string;

export interface ReaderRestoreState {
  activeItemIndex: number;
  activeUnitId?: string;
  viewportAnchor?: string;
  updatedAt?: string;
}

export interface ReaderSession {
  id: string;
  title: string;
  contentKind: 'book' | 'comic';
  surface: 'books' | 'comics' | 'uploads';
  regionId: string;
  direction: string;
  readingMode?: string;
  sourceLanguage: string;
  targetLanguage: string;
  pageViewMode: 'original' | 'translated';
  ttsLanguageMode: 'auto' | 'source' | 'target';
  audioEngine?: ReaderAudioEngine | string;
  audioEngineStatus?: ReaderAudioEngineStatus;
  voiceMode?: 'single' | 'multi' | string;
  narratorVoiceId?: string;
  translationState: 'idle' | 'warming' | 'ready' | 'error';
  translationLeadRatio?: number;
  voiceFallbacks?: Record<string, { requestedVoiceId: string; resolvedVoiceId: string; reason: string }>;
  multiSpeakerEnabled: boolean;
  effectiveMultiSpeakerMode?: 'single' | 'line_map' | 'studio_pair_groups';
  workKey: string;
  sourceKind: 'catalog' | 'upload' | string;
  provider?: string;
  license?: string;
  commercialUseStatus?: 'allowed' | 'blocked' | 'review';
  commercialUseReason?: string | null;
  coverUrl?: string;
  summary?: string;
  sourceUrl?: string;
  collectionLabel?: string;
  musicTrackId: string;
  autoAdvanceProfile?: 'off' | 'audio_sync' | 'slow' | 'medium' | 'fast' | string;
  castMemory: ReaderVoiceCast;
  consumedChars: number;
  totalChars: number;
  currentPanelIndex: number;
  totalPanels: number;
  progressPct: number;
  readiness?: ReaderReadiness;
  prep?: ReaderPreparation;
  resumeToken?: string;
  activeItemIndex?: number;
  restoreState?: ReaderRestoreState;
  unitOverrides?: Record<string, string>;
  stats?: ReaderItemStats;
  cachedChars: number;
  cacheLimitChars: number;
  deleteAtMs: number;
  warningActive: boolean;
  savepointDownloadUrl: string;
  billing: {
    vfPerChar: number;
    rule: string;
    label: string;
  };
  limits: {
    textWindowChars: number;
    prefetchThresholdChars: number;
    panelBatchSize: number;
    panelTriggerIndex: number;
    deleteWarningMs: number;
  };
  windows: ReaderAudioWindow[];
  panels: ReaderPanelManifest[];
}

export interface ReaderSessionProgress {
  consumedChars?: number;
  currentPanelIndex?: number;
  targetLanguage?: string;
  pageViewMode?: 'original' | 'translated';
  audioEngine?: ReaderAudioEngine | string;
  activeItemIndex?: number;
  activeUnitId?: string;
  viewportAnchor?: string;
}

export interface ReaderLegalAck {
  accepted: boolean;
  acceptedAt?: string;
  title: string;
  message: string;
}

export type ReaderOwnershipBasis =
  | 'own_work'
  | 'licensed'
  | 'open_license'
  | 'public_domain'
  | 'user_responsible';

export interface ReaderOwnershipBasisOption {
  value: ReaderOwnershipBasis;
  label: string;
  description: string;
}

export interface ReaderCommercialPolicy {
  enabled: boolean;
  commercialPolicyVersion?: string;
  policyVersion?: string;
  blockedProviders: string[];
  ownershipBasisOptions: ReaderOwnershipBasisOption[];
}

export interface ReaderUpload extends ReaderCatalogItem {}

export type LabAssetKind = 'audio' | 'video' | 'text' | 'image' | 'element' | 'recording' | 'tts';
export type LabLayerKind = LabAssetKind;
export type LabTrackRole = 'voice' | 'music' | 'fx' | 'video' | 'text' | 'image' | 'element' | 'recording';
export type LabRailPanelId = 'media' | 'canvas' | 'text' | 'audio' | 'videos' | 'images' | 'elements' | 'record' | 'tts';
export type LabCatalogKind = 'audio' | 'video' | 'image';
export type LabCatalogProvider = 'openverse' | 'freesound' | 'pixabay';
export type LabTool =
  | 'inspect'
  | 'trim'
  | 'split'
  | 'gain'
  | 'cleanup'
  | 'separate'
  | 'export';
export type LabEqPreset = 'flat' | 'warm' | 'presence' | 'broadcast';
export type LabJobKind = 'waveform' | 'mix' | 'stem' | 'hq_stem' | 'video_extract' | 'restore' | 'tts' | 'export' | 'record';
export type LabJobStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';
export type LabCapabilityTier = 'low' | 'standard' | 'high';
export type LabCanvasPresetId =
  | 'youtube_16_9'
  | 'youtube_shorts_9_16'
  | 'tiktok_9_16'
  | 'instagram_story_9_16'
  | 'instagram_square_1_1'
  | 'instagram_portrait_4_5'
  | 'spotify_canvas_9_16'
  | 'facebook_story_9_16'
  | 'snapchat_story_9_16'
  | 'widescreen_16_9'
  | 'full_portrait_9_16'
  | 'square_1_1'
  | 'landscape_4_3'
  | 'portrait_4_5'
  | 'landscape_post_5_4'
  | 'vertical_2_3'
  | 'ultrawide_21_9'
  | 'custom';
export type LabBrowserAccelerationDefault = 'webgpu_preferred' | 'cpu_only';
export type LabBackendHardwareDefault = 'gpu_preferred' | 'cpu_only';
export type LabPerformanceMode = 'conservative' | 'balanced';
export type LabExportStrategyDefault = 'browser_first';
export type LabPreviewQualityLevel = 'low' | 'medium' | 'high';
export type LabEffectiveBrowserMode = 'webgpu_active' | 'cpu_fallback';
export type LabEffectiveBackendMode = 'gpu_preferred' | 'cpu_only';
export type LabDegradedReason = 'none' | 'runtime_guardrails' | 'conservative_policy' | 'weak_device' | 'long_timeline' | 'backend_queue';
export type LabRecordSource = 'audio' | 'camera' | 'screen' | 'screen_camera';
export type LabTextPreset = 'title' | 'subtitle' | 'caption' | 'lower_third' | 'cta';
export type LabElementShape = 'rectangle' | 'circle' | 'pill' | 'bar' | 'frame';
export type LabStageAlignment = 'start' | 'center' | 'end';
export type LabExportStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type LabExportFormat = 'webm' | 'mp4' | 'wav';
export type LabTransitionKind = 'cut' | 'crossfade' | 'fade' | 'wipe' | 'slide';
export type LabTransitionEasing = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';

export interface LabStageTransform {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  zIndex: number;
  alignX: LabStageAlignment;
  alignY: LabStageAlignment;
  snapToCanvas: boolean;
}

export interface LabTextStyle {
  preset: LabTextPreset;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: 'left' | 'center' | 'right';
  color: string;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadow?: boolean;
}

export interface LabElementStyle {
  shape: LabElementShape;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

export interface LabWaveformData {
  coarse: number[];
  detail: number[];
  durationMs: number;
  sampleRate: number;
  channels: number;
}

export interface LabAsset {
  id: string;
  kind: LabAssetKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  objectUrl?: string;
  posterUrl?: string;
  sourceAssetId?: string;
  extractedAudioAssetId?: string;
  channelCount?: number;
  sampleRate?: number;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  stageTransform?: LabStageTransform;
  textStyle?: LabTextStyle;
  elementStyle?: LabElementStyle;
  recordSource?: LabRecordSource;
  layerKind?: LabLayerKind;
  provider?: LabCatalogProvider;
  remoteAssetId?: string;
  thumbUrl?: string;
  creator?: string;
  license?: string;
  attributionUrl?: string;
  waveform?: LabWaveformData;
  createdAt: number;
}

export interface LabTrack {
  id: string;
  name: string;
  role: LabTrackRole;
  color: string;
  collapsed?: boolean;
  muted?: boolean;
  solo?: boolean;
}

export interface LabClip {
  id: string;
  assetId: string;
  trackId: string;
  timelineRowId: string;
  layerOrder: number;
  insertedAtPlayheadMs: number;
  label: string;
  startMs: number;
  trimStartMs: number;
  trimEndMs: number;
  gain: number;
  muted: boolean;
  solo: boolean;
  playbackRate: number;
  pitchSemitones: number;
  fadeInMs: number;
  fadeOutMs: number;
  normalize: boolean;
  eqPreset: LabEqPreset;
  denoiseAmount: number;
  enabled: boolean;
  visible: boolean;
  stageTransform: LabStageTransform;
  createdAt: number;
  updatedAt: number;
}

export interface LabTransportState {
  playheadMs: number;
  zoomLevel: number;
  isPlaying: boolean;
}

export interface LabCanvasPreset {
  id: LabCanvasPresetId;
  label: string;
  width: number;
  height: number;
  aspectLabel: string;
  audienceLabel: string;
  isCustom?: boolean;
}

export interface LabCanvasState {
  presetId: LabCanvasPresetId;
  label: string;
  width: number;
  height: number;
  aspectLabel: string;
  background: string;
  isCustom?: boolean;
  customWidth?: number;
  customHeight?: number;
}

export interface LabTransition {
  id: string;
  kind: LabTransitionKind;
  fromClipId: string;
  toClipId: string;
  durationMs: number;
  easing: LabTransitionEasing;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LabJob {
  id: string;
  kind: LabJobKind;
  status: LabJobStatus;
  progressPct: number;
  message: string;
  runtime?: string;
  error?: string;
  startedAt: number;
}

export interface LabCapabilityProfile {
  tier: LabCapabilityTier;
  deviceTier?: LabCapabilityTier;
  workersSupported: boolean;
  webAudioSupported: boolean;
  indexedDbSupported: boolean;
  webGpuSupported: boolean;
  offscreenCanvasSupported: boolean;
  ffmpegSupported: boolean;
  sourceSeparationEnabled: boolean;
  audioEditingEnabled: boolean;
  videoImportEnabled: boolean;
  maxRecommendedDurationMs: number;
  autoPreviewEnabled: boolean;
  heavyToolsEnabled: boolean;
  workerThreadCap: number;
  browserKokoroEligible: boolean;
  waveformDetail: 'reduced' | 'full';
  runtimeGuardrails: {
    hydrationMs?: number;
    waveformRenderMs?: number;
    previewRenderMs?: number;
    degraded: boolean;
  };
  detail: string;
}

export interface LabRuntimeDefaults {
  browserAccelerationDefault: LabBrowserAccelerationDefault;
  backendHardwareDefault: LabBackendHardwareDefault;
  separatorBackendDefault: LabBackendHardwareDefault;
  labPerformanceMode: LabPerformanceMode;
  exportStrategyDefault: LabExportStrategyDefault;
  allowUserOverride: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface LabSeparationJobState {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string | null;
  queueDepthAtSubmit?: number;
  backendMode?: LabBackendHardwareDefault | null;
  modelName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  artifacts?: Record<string, { stemKind: string; ready: boolean; downloadUrl: string }>;
}

export interface LabRuntimeState {
  deviceTier: LabCapabilityTier;
  effectiveBrowserMode: LabEffectiveBrowserMode;
  effectiveBackendMode: LabEffectiveBackendMode;
  degradedReason: LabDegradedReason;
  previewQualityLevel: LabPreviewQualityLevel;
  autoPreviewAllowed: boolean;
  heavyToolsEnabled: boolean;
  runtimeBadge: string;
  runtimeBadgeState?: 'accelerated' | 'conservative' | 'fallback' | 'queued';
}

export interface LabCatalogItem {
  id: string;
  provider: LabCatalogProvider;
  kind: LabCatalogKind;
  title: string;
  thumbUrl?: string;
  previewUrl?: string;
  downloadUrl: string;
  durationSec?: number;
  width?: number;
  height?: number;
  license?: string;
  creator?: string;
  attributionUrl?: string;
  tags: string[];
  externalUrl?: string;
  commercialUseStatus?: 'allowed' | 'blocked' | 'review';
  commercialUseReason?: string | null;
}

export interface LabCatalogSearchResult {
  items: LabCatalogItem[];
  warnings: string[];
  nextPage?: number | null;
  commercialPolicyVersion?: string;
  blockedProviders?: string[];
}

export interface LabCatalogImportResult {
  importId: string;
  provider: LabCatalogProvider;
  item: LabCatalogItem;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentUrl: string;
}

export interface LabSession {
  version: number;
  canvas: LabCanvasState;
  assets: LabAsset[];
  tracks: LabTrack[];
  clips: LabClip[];
  transitions: LabTransition[];
  transport: LabTransportState;
}

export interface LabExportJobState {
  id: string;
  status: LabExportStatus;
  progress: number;
  message: string;
  format: LabExportFormat;
  queueDepthAtSubmit?: number;
  backendMode?: LabBackendHardwareDefault | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  artifactUrl?: string | null;
  error?: string | null;
}
