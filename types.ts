

export enum AppScreen {
  ONBOARDING = 'ONBOARDING',
  LOGIN = 'LOGIN',
  MAIN = 'MAIN',
  PROFILE = 'PROFILE'
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Male' | 'Female' | 'Unknown';
  accent: string;
  geminiVoiceName: string; // Map to actual Gemini voice names (Fallback)
  isCloned?: boolean;
  previewUrl?: string;
}

export interface RemoteSpeaker {
  id: string;
  name: string;
}

export interface ClonedVoice extends VoiceOption {
  originalSampleUrl: string;
  dateCreated: number;
  description: string;
  referenceText?: string; // For F5-TTS optimization
}

export interface MusicTrack {
  id: string;
  name: string;
  url: string;
  category: 'Calm' | 'Cinematic' | 'Upbeat' | 'Lo-Fi' | 'None' | 'Electronic' | 'Jazz' | 'Classical' | 'World' | 'Ambient' | 'Comedy' | 'Horror' | 'Romantic';
}

export interface SoundEffect {
  id: string;
  name: string;
  category: string;
  duration: number; // in seconds
  url: string;
  tags: string[];
  description?: string;
}

export interface GenerationSettings {
  voiceId: string;
  speed: number;
  pitch: 'Low' | 'Medium' | 'High';
  language: string; // Added for multi-language support
  emotion?: string; // Added for emotion control
  
  // Audio Engine Settings
  engine: 'GEM' | 'COQ' | 'OPENAI' | 'F5' | 'LOCAL_WEBGPU'; // Added F5 and LOCAL_WEBGPU
  backendUrl?: string;
  chatterboxId?: string; // Renamed from coquiSpeakerId
  openaiModel?: string; // Specific model name for OpenAI compatible endpoints
  
  // F5-TTS Specific
  f5Model?: string;
  enableWebGpu?: boolean; // Toggle for client-side optimization
  removeSilence?: boolean; 

  // AI Assistant Settings (Text/Director)
  helperProvider: 'GEMINI' | 'PERPLEXITY' | 'LOCAL';
  perplexityApiKey?: string; 
  localLlmUrl?: string;
  geminiApiKey?: string; // Optional user override

  musicTrackId?: string;
  musicVolume?: number; // 0.0 to 1.0
  speechVolume?: number; // 0.0 to 1.0
  autoEnhance?: boolean; // For auto emotions
  speakerMapping?: Record<string, string>; // Map "Speaker Name" -> "Voice ID"
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
  voiceId: string; // The preferred voice ID
  gender?: 'Male' | 'Female' | 'Unknown';
  age?: string; // 'Child', 'Young Adult', 'Adult', 'Elderly'
  avatarColor?: string; // For UI decoration
  description?: string;
}

export interface DubSegment {
  id: string;
  startTime: number; // seconds
  endTime: number; // seconds
  speaker: string;
  text: string;
  translatedText: string;
  emotion: string;
  gender: 'Male' | 'Female' | 'Unknown';
  age: string;
  audioUrl?: string;
  originalAudioUrl?: string; // For reference
}

export interface DirectorAnalysis {
  segments: DubSegment[];
  sceneMood: string;
  detectedCharacters: CharacterProfile[];
}

export interface UserStats {
  generationsUsed: number;
  generationsLimit: number;
  isPremium: boolean;
  planName: 'Free' | 'Pro' | 'Enterprise';
  lastResetDate?: string; // Track when the limit was last reset
}

export interface UserProfile {
  googleId: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface HistoryItem {
  id: string;
  text: string;
  audioUrl: string; // Local blob or CDN url
  voiceName: string;
  timestamp: number;
  duration?: string;
}

export interface UserContextType {
  user: UserProfile;
  updateUser: (u: Partial<UserProfile>) => void;
  stats: UserStats;
  updateStats: (newStats: Partial<UserStats>) => void;
  history: HistoryItem[];
  addToHistory: (item: HistoryItem) => void;
  clearHistory: () => void;
  deleteAccount: () => void;
  clonedVoices: ClonedVoice[];
  addClonedVoice: (voice: ClonedVoice) => void;
  drafts: Draft[];
  saveDraft: (name: string, text: string, settings: GenerationSettings) => void;
  deleteDraft: (id: string) => void;
  showSubscriptionModal: boolean;
  setShowSubscriptionModal: (show: boolean) => void;
  watchAd: () => Promise<void>;
  
  // New Character Memory
  characterLibrary: CharacterProfile[];
  updateCharacter: (character: CharacterProfile) => void;
  deleteCharacter: (id: string) => void;
  getVoiceForCharacter: (name: string) => string | undefined;
  
  // Guest Mode
  loginAsGuest: () => void;
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
}