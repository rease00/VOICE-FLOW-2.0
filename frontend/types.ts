export enum AppScreen {
  ONBOARDING = 'ONBOARDING',
  LOGIN = 'LOGIN',
  USER_ID_SETUP = 'USER_ID_SETUP',
  MAIN = 'MAIN',
  PROFILE = 'PROFILE',
}

export type TtsEngineKey = 'VECTOR' | 'PRIME';
export type ActiveTtsEngineKey = TtsEngineKey;

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Male' | 'Female' | 'Unknown';
  accent: string;
  geminiVoiceName: string;
  country?: string;
  ageGroup?: string;
  engine?: TtsEngineKey;
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
  referenceAudioUrl?: string;
  referenceAudioName?: string;
  referenceArtifactId?: string;
  sourceVoiceId?: string;
  sourceVoiceName?: string;
  sourceVoiceEngine?: TtsEngineKey | string;
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
  engine: TtsEngineKey;

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
  geminiTtsServiceUrl?: string | undefined;
  kokoroTtsServiceUrl?: string | undefined;
  kokoroStandbyIdleMs?: number | undefined;
  runtimeProvider?: string | undefined;

  // Studio controls
  musicTrackId?: string | undefined;
  musicVolume?: number | undefined;
  speechVolume?: number | undefined;
  autoEnhance?: boolean | undefined;
  useModelSourceSeparation?: boolean | undefined;
  preserveDubVoiceTone?: boolean | undefined;
  dubbingSourceLanguage?: string | undefined;
  multiSpeakerEnabled?: boolean | undefined;
  speakerMapping?: Record<string, string> | undefined;

  // Frontend UI preferences
  uiMotionLevel?: 'off' | 'balanced' | 'rich' | undefined;
  autoPlayGeneratedAudio?: boolean | undefined;
}

export type ScriptBlockType = 'dialogue' | 'sfx' | 'direction';
export type StudioEditorMode = 'blocks' | 'raw';
export type WorkspaceLayoutMode = 'phone' | 'tablet' | 'desktop';
export type CpuDubbingProfile = 'cpu_quality' | 'cpu_speed' | 'gpu';

export interface DubbingClip {
  id: string;
  file: File;
  objectUrl: string;
  durationMs: number;
  trimInMs: number;
  trimOutMs: number;
  layer: 'V1' | 'V2';
  script: string;
  status: 'idle' | 'transcribing' | 'queued' | 'running' | 'completed' | 'failed';
  jobId: string;
  resultUrl: string | null;
  reportUrl: string | null;
  error: string;
}

export interface DubbingClipboard {
  clip: DubbingClip;
  timestamp: number;
}

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

export type StudioQueueItemStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cooldown'
  | 'failed'
  | 'cancelled';

export interface StudioQueueItem {
  id: string;
  order: number;
  label: string;
  status: StudioQueueItemStatus;
  sourceText: string;
  charCount: number;
  requestId?: string | undefined;
  jobId?: string | undefined;
  audioCacheKey?: string | undefined;
  error?: string | undefined;
  cooldownUntil?: number | undefined;
  startedAt?: number | undefined;
  firstAudioAt?: number | undefined;
  timeToFirstAudioMs?: number | undefined;
  totalGenerationMs?: number | undefined;
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

export interface StudioSingleInflightGenerationLedger {
  mode: 'single';
  requestId?: string | undefined;
  jobId?: string | undefined;
  textSnapshot: string;
  startedAtMs: number;
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
  byEngine: Record<ActiveTtsEngineKey, VfEngineUsage>;
}

export interface VfUsageStats {
  unit: 'VF';
  rates: Record<ActiveTtsEngineKey, number>;
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
  vcFreeBalance?: number;
  vcGrantedBalance?: number;
  vcPaidBalance?: number;
  vcSpendableBalance?: number;
  spendableNowByEngine: Record<ActiveTtsEngineKey, number>;
  vffMonthKey?: string | undefined;
  vcMonthKey?: string | undefined;
  vnBalance?: number;
}

export interface UserStats {
  generationsUsed: number;
  isPremium: boolean;
  planName: 'Free' | 'Launcher' | 'Starter' | 'Creator' | 'Pro' | 'Scale' | 'Plus' | 'Enterprise';
  lastResetDate?: string | undefined;
  billingCountry?: string | undefined;
  vfUsage: VfUsageStats;
  wallet: UserWalletStats;
  limits?: {
    maxCharsPerGeneration: number;
    allowedEngines: ActiveTtsEngineKey[];
    tokenPackDiscountPercent?: number | undefined;
    vcTokenPackDiscountPercent?: number | undefined;
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
  engine?: TtsEngineKey | undefined;
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
  requiresEmailVerification?: boolean;
  canResendVerification?: boolean;
  provisioningHint?: string;
}

export interface SignUpActionResult extends AuthActionResult {
  requiresEmailVerification?: boolean;
}

export interface UserContextType {
  user: UserProfile;
  authReady: boolean;
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
  showSubscriptionModal: boolean;
  setShowSubscriptionModal: (show: boolean) => void;
  recordTtsUsage: (engine: GenerationSettings['engine'], charCount: number) => void;

  characterLibrary: CharacterProfile[];
  updateCharacter: (character: CharacterProfile) => void;
  deleteCharacter: (id: string) => void;
  getVoiceForCharacter: (name: string) => string | undefined;

  signInWithEmail: (email: string, password: string) => Promise<SignInActionResult>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<SignUpActionResult>;
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
  engine: TtsEngineKey;
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
  request_id?: string | undefined;
}

// ─── VN Token Economy Types ──────────────────────────────────────────

export type VnTokenType = 'VN';
export type TokenType = 'VN' | 'VF' | 'VC';

export type VnTransactionType =
  | 'vn_purchase'
  | 'chapter_unlock'
  | 'full_novel_unlock'
  | 'author_earning'
  | 'withdrawal'
  | 'refund'
  | 'daily_free_unlock';

export interface VnTransaction {
  id: string;
  userId: string;
  type: VnTransactionType;
  amount: number;
  tokenType: TokenType;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  timestamp: string;
  metadata?: {
    bookId?: string;
    chapterId?: string;
    packKey?: string;
    withdrawalId?: string;
    razorpayOrderId?: string;
  };
}

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface WithdrawalRequest {
  id: string;
  userId: string;
  vnAmount: number;
  inrAmount: number;
  platformFee: number;
  netAmount: number;
  bankDetails: {
    accountNumber: string;
    ifsc: string;
    beneficiaryName: string;
  };
  status: WithdrawalStatus;
  createdAt: string;
  processedAt?: string;
  completedAt?: string;
  razorpayPayoutId?: string;
  error?: string;
}

export interface ChapterUnlockStatus {
  chapterId: string;
  bookId: string;
  unlocked: boolean;
  unlockedAt?: string;
  method?: 'purchase' | 'full_novel' | 'daily_free';
}

// ─── Unified User Model (Firestore users/{uid}) ─────────────────────

export interface UserBankDetails {
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected';

export interface FirestoreUserDoc {
  /** Core fields (existing) */
  isAdmin?: boolean;
  displayName?: string;
  email?: string;
  photoURL?: string;

  /** Novel economy additions */
  vnBalance: number;
  kycStatus: KycStatus;
  referralCode: string;
  bankDetails?: UserBankDetails;
  signupBonusCredited: boolean;
  favoriteBooks: string[];

  /** Wallet sub-doc reference */
  wallets?: {
    vffBalance?: number;
    paidVfBalance?: number;
    vcFreeBalance?: number;
    vcPaidBalance?: number;
    monthly?: Record<string, unknown>;
  };
}

