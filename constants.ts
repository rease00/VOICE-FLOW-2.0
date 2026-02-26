import { VoiceOption, MusicTrack, LanguageOption, SoundEffect, UserStats } from './types';
import { createEmptyVfUsageStats } from './services/usageMetering';

// ============================================================================
// VOICES - 30 Valid Voice Options mapped to Gemini Supported Models
// Supported: achernar, achird, algenib, algieba, alnilam, aoede, autonoe, 
// callirrhoe, charon, despina, enceladus, erinome, fenrir, gacrux, iapetus, 
// kore, laomedeia, leda, orus, puck, pulcherrima, rasalgethi, sadachbia, 
// sadaltager, schedar, sulafat, umbriel, vindemiatrix, zephyr, zubenelgenubi
// ============================================================================

export const VOICES: VoiceOption[] = [
  // American English Voices
  { id: 'v1', name: 'David', gender: 'Male', accent: 'American English', geminiVoiceName: 'Fenrir' },
  { id: 'v2', name: 'Sarah', gender: 'Female', accent: 'American English', geminiVoiceName: 'Kore' },
  { id: 'v3', name: 'Marcus', gender: 'Male', accent: 'American English', geminiVoiceName: 'Alnilam' },
  { id: 'v4', name: 'Jennifer', gender: 'Female', accent: 'American English', geminiVoiceName: 'Leda' },
  { id: 'v5', name: 'Robert', gender: 'Male', accent: 'American English', geminiVoiceName: 'Iapetus' },
  { id: 'v6', name: 'Jessica', gender: 'Female', accent: 'American English', geminiVoiceName: 'Autonoe' },
  { id: 'v7', name: 'William', gender: 'Male', accent: 'American English', geminiVoiceName: 'Enceladus' },
  { id: 'v8', name: 'Ashley', gender: 'Female', accent: 'American English', geminiVoiceName: 'Erinome' },
  
  // British English Voices
  { id: 'v9', name: 'Michael', gender: 'Male', accent: 'British English', geminiVoiceName: 'Puck' },
  { id: 'v10', name: 'Emily', gender: 'Female', accent: 'British English', geminiVoiceName: 'Charon' },
  { id: 'v11', name: 'Oliver', gender: 'Male', accent: 'British English', geminiVoiceName: 'Achernar' },
  { id: 'v12', name: 'Charlotte', gender: 'Female', accent: 'British English', geminiVoiceName: 'Despina' },
  { id: 'v13', name: 'George', gender: 'Male', accent: 'British English', geminiVoiceName: 'Algenib' },
  { id: 'v14', name: 'Victoria', gender: 'Female', accent: 'British English', geminiVoiceName: 'Algieba' },
  
  // Australian English Voices
  { id: 'v15', name: 'James', gender: 'Male', accent: 'Australian English', geminiVoiceName: 'Zephyr' },
  { id: 'v16', name: 'Sophie', gender: 'Female', accent: 'Australian English', geminiVoiceName: 'Callirrhoe' },
  { id: 'v17', name: 'Jack', gender: 'Male', accent: 'Australian English', geminiVoiceName: 'Achird' },
  { id: 'v18', name: 'Olivia', gender: 'Female', accent: 'Australian English', geminiVoiceName: 'Aoede' },
  
  // Canadian / Other
  { id: 'v19', name: 'Nathan', gender: 'Male', accent: 'Canadian English', geminiVoiceName: 'Gacrux' },
  { id: 'v20', name: 'Emma', gender: 'Female', accent: 'Canadian English', geminiVoiceName: 'Laomedeia' },
  { id: 'v21', name: 'Liam', gender: 'Male', accent: 'Canadian English', geminiVoiceName: 'Orus' },
  
  // European/Distinctive
  { id: 'v22', name: 'Connor', gender: 'Male', accent: 'Irish English', geminiVoiceName: 'Pulcherrima' },
  { id: 'v23', name: 'Siobhan', gender: 'Female', accent: 'Irish English', geminiVoiceName: 'Rasalgethi' },
  { id: 'v24', name: 'Patrick', gender: 'Male', accent: 'Irish English', geminiVoiceName: 'Sadachbia' },
  { id: 'v25', name: 'Duncan', gender: 'Male', accent: 'Scottish English', geminiVoiceName: 'Sadaltager' },
  { id: 'v26', name: 'Isla', gender: 'Female', accent: 'Scottish English', geminiVoiceName: 'Schedar' },
  
  // Indian English
  { id: 'v27', name: 'Rajesh', gender: 'Male', accent: 'Indian English', geminiVoiceName: 'Sulafat' },
  { id: 'v28', name: 'Priya', gender: 'Female', accent: 'Indian English', geminiVoiceName: 'Umbriel' },
  { id: 'v29', name: 'Arun', gender: 'Male', accent: 'Indian English', geminiVoiceName: 'Vindemiatrix' },
  { id: 'v30', name: 'Anjali', gender: 'Female', accent: 'Indian English', geminiVoiceName: 'Zubenelgenubi' }
];

// ============================================================================
// KOKORO VOICES - Aligned with local Kokoro runtime voice registry
// ============================================================================
export const KOKORO_VOICES: VoiceOption[] = [
  { id: 'af_heart', name: 'Heart', gender: 'Female', accent: 'American English', geminiVoiceName: 'af_heart', country: 'United States', ageGroup: 'Adult' },
  { id: 'af_bella', name: 'Bella', gender: 'Female', accent: 'American English', geminiVoiceName: 'af_bella', country: 'United States', ageGroup: 'Adult' },
  { id: 'af_nova', name: 'Nova', gender: 'Female', accent: 'American English', geminiVoiceName: 'af_nova', country: 'United States', ageGroup: 'Adult' },
  { id: 'af_sarah', name: 'Sarah', gender: 'Female', accent: 'American English', geminiVoiceName: 'af_sarah', country: 'United States', ageGroup: 'Adult' },
  { id: 'am_fenrir', name: 'Fenrir', gender: 'Male', accent: 'American English', geminiVoiceName: 'am_fenrir', country: 'United States', ageGroup: 'Adult' },
  { id: 'am_michael', name: 'Michael', gender: 'Male', accent: 'American English', geminiVoiceName: 'am_michael', country: 'United States', ageGroup: 'Adult' },
  { id: 'am_onyx', name: 'Onyx', gender: 'Male', accent: 'American English', geminiVoiceName: 'am_onyx', country: 'United States', ageGroup: 'Adult' },
  { id: 'am_echo', name: 'Echo', gender: 'Male', accent: 'American English', geminiVoiceName: 'am_echo', country: 'United States', ageGroup: 'Adult' },
  { id: 'bf_emma', name: 'Emma', gender: 'Female', accent: 'British English', geminiVoiceName: 'bf_emma', country: 'United Kingdom', ageGroup: 'Adult' },
  { id: 'bf_isabella', name: 'Isabella', gender: 'Female', accent: 'British English', geminiVoiceName: 'bf_isabella', country: 'United Kingdom', ageGroup: 'Adult' },
  { id: 'bm_george', name: 'George', gender: 'Male', accent: 'British English', geminiVoiceName: 'bm_george', country: 'United Kingdom', ageGroup: 'Adult' },
  { id: 'bm_fable', name: 'Fable', gender: 'Male', accent: 'British English', geminiVoiceName: 'bm_fable', country: 'United Kingdom', ageGroup: 'Adult' },
  { id: 'hf_alpha', name: 'Hindi Alpha', gender: 'Female', accent: 'Hindi', geminiVoiceName: 'hf_alpha', country: 'India', ageGroup: 'Adult' },
  { id: 'hf_beta', name: 'Hindi Beta', gender: 'Female', accent: 'Hindi', geminiVoiceName: 'hf_beta', country: 'India', ageGroup: 'Adult' },
  { id: 'hm_omega', name: 'Hindi Omega', gender: 'Male', accent: 'Hindi', geminiVoiceName: 'hm_omega', country: 'India', ageGroup: 'Adult' },
  { id: 'hm_psi', name: 'Hindi Psi', gender: 'Male', accent: 'Hindi', geminiVoiceName: 'hm_psi', country: 'India', ageGroup: 'Adult' },
];

// ============================================================================
// OPENAI COMPATIBLE VOICES
// Standard voices often supported by local OpenAI-compatible backends
// ============================================================================
export const OPENAI_VOICES: VoiceOption[] = [
  { id: 'alloy', name: 'Alloy', gender: 'Unknown', accent: 'Neutral', geminiVoiceName: 'alloy' },
  { id: 'echo', name: 'Echo', gender: 'Male', accent: 'Neutral', geminiVoiceName: 'echo' },
  { id: 'fable', name: 'Fable', gender: 'Unknown', accent: 'British', geminiVoiceName: 'fable' },
  { id: 'onyx', name: 'Onyx', gender: 'Male', accent: 'Deep', geminiVoiceName: 'onyx' },
  { id: 'nova', name: 'Nova', gender: 'Female', accent: 'Energetic', geminiVoiceName: 'nova' },
  { id: 'shimmer', name: 'Shimmer', gender: 'Female', accent: 'Clear', geminiVoiceName: 'shimmer' }
];

// ============================================================================
// F5-TTS PRESETS
// Base voices for the F5 model
// ============================================================================
export const F5_VOICES: VoiceOption[] = [
  { id: 'f5_basic_m', name: 'F5 Male (Base)', gender: 'Male', accent: 'Neutral', geminiVoiceName: 'f5_male' },
  { id: 'f5_basic_f', name: 'F5 Female (Base)', gender: 'Female', accent: 'Neutral', geminiVoiceName: 'f5_female' },
];


// ============================================================================
// LANGUAGES - 80+ Languages with native names and RTL support
// ============================================================================

export const LANGUAGES: LanguageOption[] = [
  // English Variants
  { code: 'en', name: 'English', nativeName: 'English', rtl: false },
  { code: 'en-US', name: 'English (US)', nativeName: 'English (US)', rtl: false },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)', rtl: false },
  { code: 'en-AU', name: 'English (Australia)', nativeName: 'English (Australia)', rtl: false },
  { code: 'en-CA', name: 'English (Canada)', nativeName: 'English (Canada)', rtl: false },
  { code: 'en-IN', name: 'English (India)', nativeName: 'English (India)', rtl: false },
  
  // Indian Languages
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', rtl: false },
  { code: 'hi-latn', name: 'Hinglish', nativeName: 'Hinglish', rtl: false },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', rtl: false },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', rtl: false },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', rtl: false },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', rtl: false },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', rtl: true },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', rtl: false },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', rtl: false },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', rtl: false },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', rtl: false },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', rtl: false },
  
  // European Languages
  { code: 'es', name: 'Spanish', nativeName: 'Español', rtl: false },
  { code: 'fr', name: 'French', nativeName: 'Français', rtl: false },
  { code: 'de', name: 'German', nativeName: 'Deutsch', rtl: false },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', rtl: false },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', rtl: false },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', rtl: false },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', rtl: false },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', rtl: false },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', rtl: false },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', rtl: false },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', rtl: false },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', rtl: false },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', rtl: false },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', rtl: false },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', rtl: false },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', rtl: false },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', rtl: false },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', rtl: false },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', rtl: false },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', rtl: false },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', rtl: false },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', rtl: false },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', rtl: false },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', rtl: false },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', rtl: false },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska', rtl: false },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', rtl: false },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg', rtl: false },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', rtl: false },
  { code: 'mk', name: 'Macedonian', nativeName: 'Македонски', rtl: false },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', rtl: false },
  { code: 'bs', name: 'Bosnian', nativeName: 'Bosanski', rtl: false },
  
  // Asian Languages
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', rtl: false },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', rtl: false },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', rtl: false },
  { code: 'ko', name: 'Korean', nativeName: '한국어', rtl: false },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', rtl: false },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', rtl: false },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', rtl: false },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', rtl: false },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', rtl: false },
  { code: 'lo', name: 'Lao', nativeName: 'ລາວ', rtl: false },
  { code: 'my', name: 'Burmese', nativeName: 'မြန်မာ', rtl: false },
  { code: 'km', name: 'Khmer', nativeName: 'ខ្មែរ', rtl: false },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', rtl: false },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', rtl: false },
  
  // Middle Eastern & African Languages
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', rtl: true },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', rtl: true },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', rtl: false },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', rtl: false },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', rtl: false },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa', rtl: false },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', rtl: false },
  { code: 'ig', name: 'Igbo', nativeName: 'Igbo', rtl: false },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu', rtl: false },
  { code: 'xh', name: 'Xhosa', nativeName: 'isiXhosa', rtl: false },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', rtl: false },
  
  // Other Languages
  { code: 'az', name: 'Azerbaijani', nativeName: 'Azərbaycan', rtl: false },
  { code: 'kk', name: 'Kazakh', nativeName: 'Қазақ', rtl: false },
  { code: 'uz', name: 'Uzbek', nativeName: 'Oʻzbek', rtl: false },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული', rtl: false },
  { code: 'hy', name: 'Armenian', nativeName: 'Հայերեն', rtl: false },
  { code: 'mn', name: 'Mongolian', nativeName: 'Монгол', rtl: false },
  { code: 'ps', name: 'Pashto', nativeName: 'پښتو', rtl: true }
];

// ============================================================================
// EMOTIONS - Canonical Runtime-Compatible Tag Set
// ============================================================================

export const EMOTIONS = [
  'Neutral',
  'Calm',
  'Relaxed',
  'Happy',
  'Joyful',
  'Cheerful',
  'Excited',
  'Energetic',
  'Optimistic',
  'Hopeful',
  'Grateful',
  'Confident',
  'Determined',
  'Heroic',
  'Proud',
  'Serious',
  'Authoritative',
  'Formal',
  'Persuasive',
  'Motivational',
  'Warm Storytelling',
  'Cinematic Narration',
  'Dark Storytelling',
  'Mystical',
  'Devotional',
  'Spiritual',
  'Romantic',
  'Loving',
  'Affectionate',
  'Empathetic',
  'Compassionate',
  'Reflective',
  'Nostalgic',
  'Melancholic',
  'Sad',
  'Tearful',
  'Crying',
  'Anxious',
  'Fearful',
  'Tense',
  'Suspenseful',
  'Surprised',
  'Shocked',
  'Disgusted',
  'Angry',
  'Furious',
  'Frustrated',
  'Sarcastic',
  'Taunting',
  'Mocking',
  'Playful',
  'Childlike',
  'Elderly Gentle',
  'Whispering',
  'Soft Spoken',
  'Breathless',
  'Panting',
  'Laughing',
  'Sighing',
  'Gasping',
  'Shouting',
  'Screaming',
  'Coughing',
  'Yawning',
  'Throat Clearing',
  'Sneezing',
  'Moaning'
];

// ============================================================================
// MUSIC TRACKS - Downloaded Local Background Tracks
// ============================================================================

export const MUSIC_TRACKS: MusicTrack[] = [
  { id: 'm_none', name: 'No Background Music', url: '', category: 'None' },
  { id: 'm_cinematic_melody', name: 'Cinematic Melody', url: '/assets/audio/music/cinematic_melody.mp3', category: 'Cinematic' },
  { id: 'm_just_relax', name: 'Just Relax', url: '/assets/audio/music/just_relax.mp3', category: 'Calm' },
  { id: 'm_beyond_horizons', name: 'Beyond Horizons', url: '/assets/audio/music/beyond_horizons.mp3', category: 'Cinematic' },
  { id: 'm_autumn_piano', name: 'Autumn Piano', url: '/assets/audio/music/autumn_is_coming_piano.mp3', category: 'Calm' },
  { id: 'm_lofi', name: 'Lo-Fi Chill', url: '/assets/audio/music/lofi_chill.mp3', category: 'Lo-Fi' },
  { id: 'm_corporate_upbeat', name: 'Corporate Upbeat', url: '/assets/audio/music/corporate_upbeat.mp3', category: 'Upbeat' },
  { id: 'm_chill_synthwave', name: 'Chill Synthwave', url: '/assets/audio/music/chill_synthwave_80x.mp3', category: 'Electronic' },
  { id: 'm_soaring_heights', name: 'Soaring Heights', url: '/assets/audio/music/soaring_heights.mp3', category: 'Cinematic' },
];

// ============================================================================
// SFX LIBRARY - Downloaded Local Sound Effects
// ============================================================================
export const SFX_LIBRARY: SoundEffect[] = [
  { id: 'level_up', name: 'Level Up', category: 'UI', duration: 2.14, url: '/assets/audio/sfx/level_up.mp3', tags: ['ui', 'levelup', 'reward', 'success'], description: 'UI level up cue.' },
  { id: 'punch', name: 'Punch Hit', category: 'Impacts', duration: 1.52, url: '/assets/audio/sfx/punch_hit.mp3', tags: ['punch', 'hit', 'impact', 'fight'], description: 'Short punch impact.' },
  { id: 'scream', name: 'Scream', category: 'Horror', duration: 6.05, url: '/assets/audio/sfx/scream.mp3', tags: ['scream', 'fear', 'horror', 'panic'], description: 'Human scream effect.' },
  { id: 'boost', name: 'Boost Transition', category: 'Transitions', duration: 1.8, url: '/assets/audio/sfx/boost_transition.mp3', tags: ['boost', 'rise', 'transition', 'swoosh'], description: 'Short boost transition.' },
  { id: 'whoosh', name: 'Whoosh', category: 'Transitions', duration: 0.57, url: '/assets/audio/sfx/whoosh.mp3', tags: ['whoosh', 'swipe', 'transition', 'fast'], description: 'Fast whoosh transition.' },
  { id: 'applause_cheer', name: 'Applause Cheer', category: 'Crowd', duration: 8.04, url: '/assets/audio/sfx/applause_cheer.mp3', tags: ['applause', 'cheer', 'crowd', 'celebration'], description: 'Crowd applause and cheer.' },
  { id: 'dog_bark', name: 'Dog Bark', category: 'Animals', duration: 2.82, url: '/assets/audio/sfx/dog_bark.mp3', tags: ['dog', 'bark', 'animal'], description: 'Dog barking effect.' },
  { id: 'sliding_door', name: 'Sliding Door', category: 'Doors', duration: 4.87, url: '/assets/audio/sfx/sliding_door.mp3', tags: ['door', 'sliding', 'open', 'close'], description: 'Sliding door movement.' },
  { id: 'door_open_close', name: 'Door Open Close', category: 'Doors', duration: 1.97, url: '/assets/audio/sfx/door_open_close.mp3', tags: ['door', 'open', 'close', 'handle'], description: 'Door open and close effect.' },
  { id: 'door_lock', name: 'Door Lock', category: 'Doors', duration: 0.82, url: '/assets/audio/sfx/door_lock.mp3', tags: ['door', 'lock', 'unlock', 'click'], description: 'Door lock click.' },
  { id: 'light_rain', name: 'Light Rain', category: 'Environment', duration: 104.36, url: '/assets/audio/sfx/light_rain.mp3', tags: ['rain', 'weather', 'ambient', 'storm'], description: 'Long light rain ambience.' },
];

// ============================================================================
// USER STATS - Initial Configuration
// ============================================================================

export const INITIAL_STATS: UserStats = {
  generationsUsed: 0,
  generationsLimit: 5,
  isPremium: false,
  planName: 'Free',
  vfUsage: createEmptyVfUsageStats(),
};

