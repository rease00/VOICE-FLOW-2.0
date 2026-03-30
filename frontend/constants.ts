import { VoiceOption, MusicTrack, LanguageOption, SoundEffect, UserStats } from './types';
import { createEmptyVfUsageStats, createEmptyWalletStats } from './services/usageMetering';

// ============================================================================
// VOICES - 30 Valid Voice Options mapped to Gemini Supported Models
// Supported: achernar, achird, algenib, algieba, alnilam, aoede, autonoe, 
// callirrhoe, charon, despina, enceladus, erinome, fenrir, gacrux, iapetus, 
// kore, laomedeia, leda, orus, puck, pulcherrima, rasalgethi, sadachbia, 
// sadaltager, schedar, sulafat, umbriel, vindemiatrix, zephyr, zubenelgenubi
// ============================================================================

export const VOICES: VoiceOption[] = [
  // American English Voices
  { id: 'v1', name: 'Arjun India Male', gender: 'Male', accent: 'American English', geminiVoiceName: 'Fenrir' },
  { id: 'v2', name: 'Meera India Female', gender: 'Female', accent: 'American English', geminiVoiceName: 'Kore' },
  { id: 'v3', name: 'Ethan US Male', gender: 'Male', accent: 'American English', geminiVoiceName: 'Alnilam' },
  { id: 'v4', name: 'Ava US Female', gender: 'Female', accent: 'American English', geminiVoiceName: 'Leda' },
  { id: 'v5', name: 'Oliver UK Male', gender: 'Male', accent: 'American English', geminiVoiceName: 'Iapetus' },
  { id: 'v6', name: 'Emily UK Female', gender: 'Female', accent: 'American English', geminiVoiceName: 'Autonoe' },
  { id: 'v7', name: 'Liam Canada Male', gender: 'Male', accent: 'American English', geminiVoiceName: 'Enceladus' },
  { id: 'v8', name: 'Sophie Canada Female', gender: 'Female', accent: 'American English', geminiVoiceName: 'Erinome' },
  
  // British English Voices
  { id: 'v9', name: 'Noah Australia Male', gender: 'Male', accent: 'British English', geminiVoiceName: 'Puck' },
  { id: 'v10', name: 'Isla Australia Female', gender: 'Female', accent: 'British English', geminiVoiceName: 'Charon' },
  { id: 'v11', name: 'Kenji Japan Male', gender: 'Male', accent: 'British English', geminiVoiceName: 'Achernar' },
  { id: 'v12', name: 'Yui Japan Female', gender: 'Female', accent: 'British English', geminiVoiceName: 'Despina' },
  { id: 'v13', name: 'Lucas Brazil Male', gender: 'Male', accent: 'British English', geminiVoiceName: 'Algenib' },
  { id: 'v14', name: 'Camila Brazil Female', gender: 'Female', accent: 'British English', geminiVoiceName: 'Algieba' },
  
  // Australian English Voices
  { id: 'v15', name: 'Mateo Spain Male', gender: 'Male', accent: 'Australian English', geminiVoiceName: 'Zephyr' },
  { id: 'v16', name: 'Valentina Spain Female', gender: 'Female', accent: 'Australian English', geminiVoiceName: 'Callirrhoe' },
  { id: 'v17', name: 'Adi India Boy', gender: 'Male', accent: 'Australian English', geminiVoiceName: 'Achird' },
  { id: 'v18', name: 'Tara India Girl', gender: 'Female', accent: 'Australian English', geminiVoiceName: 'Aoede' },
  
  // Canadian / Other
  { id: 'v19', name: 'Raghu India Elder', gender: 'Male', accent: 'Canadian English', geminiVoiceName: 'Gacrux' },
  { id: 'v20', name: 'Grace UK Elder', gender: 'Female', accent: 'Canadian English', geminiVoiceName: 'Laomedeia' },
  { id: 'v21', name: 'Noir Novel Artist', gender: 'Male', accent: 'Canadian English', geminiVoiceName: 'Orus' },
  
  // European/Distinctive
  { id: 'v22', name: 'Lyris Novel Artist', gender: 'Female', accent: 'Irish English', geminiVoiceName: 'Pulcherrima' },
  { id: 'v23', name: 'Hans Germany Male', gender: 'Male', accent: 'Irish English', geminiVoiceName: 'Rasalgethi' },
  { id: 'v24', name: 'Anna Germany Female', gender: 'Female', accent: 'Irish English', geminiVoiceName: 'Sadachbia' },
  { id: 'v25', name: 'Pierre France Male', gender: 'Male', accent: 'Scottish English', geminiVoiceName: 'Sadaltager' },
  { id: 'v26', name: 'Claire France Female', gender: 'Female', accent: 'Scottish English', geminiVoiceName: 'Schedar' },
  
  // Indian English
  { id: 'v27', name: 'Omar UAE Male', gender: 'Male', accent: 'Indian English', geminiVoiceName: 'Sulafat' },
  { id: 'v28', name: 'Leila UAE Female', gender: 'Female', accent: 'Indian English', geminiVoiceName: 'Umbriel' },
  { id: 'v29', name: 'Ivan Russia Male', gender: 'Male', accent: 'Indian English', geminiVoiceName: 'Vindemiatrix' },
  { id: 'v30', name: 'Alina Russia Female', gender: 'Female', accent: 'Indian English', geminiVoiceName: 'Zubenelgenubi' }
];

// ============================================================================
// DUNO VOICES - DeepInfra default plus runtime/native clones
// ============================================================================
export const DUNO_DEFAULT_VOICE_ID = 'deepinfra_default';
export const DUNO_LEGACY_PRESET_IDS = [
  'af_heart',
  'af_bella',
  'af_nova',
  'af_sarah',
  'am_fenrir',
  'am_michael',
  'am_onyx',
  'am_echo',
  'bf_emma',
  'bf_isabella',
  'bm_george',
  'bm_fable',
  'hf_alpha',
  'hf_beta',
  'hm_omega',
  'hm_psi',
] as const;

export const DUNO_VOICES: VoiceOption[] = [
  {
    id: DUNO_DEFAULT_VOICE_ID,
    name: 'Default Duno',
    gender: 'Unknown',
    accent: 'DeepInfra default',
    geminiVoiceName: DUNO_DEFAULT_VOICE_ID,
    country: 'Global',
    ageGroup: 'Adult',
    source: 'deepinfra_default',
    accessTier: 'free',
    isPlanRestricted: false,
  },
];

export const LEGACY_DUNO_VOICE_LABELS: Record<string, string> = {
  af_heart: 'Lyra US',
  af_bella: 'Kaia US',
  af_nova: 'Mira US',
  af_sarah: 'Zoya US',
  am_fenrir: 'Rian US',
  am_michael: 'Lucan US',
  am_onyx: 'Soren US',
  am_echo: 'Darian US',
  bf_emma: 'Elara UK',
  bf_isabella: 'Cora UK',
  bm_george: 'Alden UK',
  bm_fable: 'Osric UK',
  hf_alpha: 'Kavya IN',
  hf_beta: 'Isha IN',
  hm_omega: 'Aarav IN',
  hm_psi: 'Veer IN',
};

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
  { id: 'f5_base_m', name: 'F5 Male (Base)', gender: 'Male', accent: 'Neutral', geminiVoiceName: 'f5_male' },
  { id: 'f5_base_f', name: 'F5 Female (Base)', gender: 'Female', accent: 'Neutral', geminiVoiceName: 'f5_female' },
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
  { code: 'hi', name: 'Hindi', nativeName: '??????', rtl: false },
  { code: 'hi-latn', name: 'Hinglish', nativeName: 'Hinglish', rtl: false },
  { code: 'bn', name: 'Bengali', nativeName: '?????', rtl: false },
  { code: 'te', name: 'Telugu', nativeName: '??????', rtl: false },
  { code: 'mr', name: 'Marathi', nativeName: '?????', rtl: false },
  { code: 'ta', name: 'Tamil', nativeName: '?????', rtl: false },
  { code: 'ur', name: 'Urdu', nativeName: '????', rtl: true },
  { code: 'gu', name: 'Gujarati', nativeName: '???????', rtl: false },
  { code: 'kn', name: 'Kannada', nativeName: '?????', rtl: false },
  { code: 'ml', name: 'Malayalam', nativeName: '??????', rtl: false },
  { code: 'pa', name: 'Punjabi', nativeName: '??????', rtl: false },
  { code: 'or', name: 'Odia', nativeName: '?????', rtl: false },
  
  // European Languages
  { code: 'es', name: 'Spanish', nativeName: 'Espa?ol', rtl: false },
  { code: 'fr', name: 'French', nativeName: 'Fran?ais', rtl: false },
  { code: 'de', name: 'German', nativeName: 'Deutsch', rtl: false },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', rtl: false },
  { code: 'pt', name: 'Portuguese', nativeName: 'Portugu?s', rtl: false },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Portugu?s (Brasil)', rtl: false },
  { code: 'ru', name: 'Russian', nativeName: '???????', rtl: false },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', rtl: false },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', rtl: false },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', rtl: false },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', rtl: false },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', rtl: false },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', rtl: false },
  { code: 'uk', name: 'Ukrainian', nativeName: '??????????', rtl: false },
  { code: 'el', name: 'Greek', nativeName: '????????', rtl: false },
  { code: 'cs', name: 'Czech', nativeName: '?e?tina', rtl: false },
  { code: 'ro', name: 'Romanian', nativeName: 'Rom?n?', rtl: false },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', rtl: false },
  { code: 'bg', name: 'Bulgarian', nativeName: '?????????', rtl: false },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', rtl: false },
  { code: 'sk', name: 'Slovak', nativeName: 'Sloven?ina', rtl: false },
  { code: 'sl', name: 'Slovenian', nativeName: 'Sloven??ina', rtl: false },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvi?', rtl: false },
  { code: 'lv', name: 'Latvian', nativeName: 'Latvie?u', rtl: false },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', rtl: false },
  { code: 'is', name: 'Icelandic', nativeName: '?slenska', rtl: false },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', rtl: false },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg', rtl: false },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', rtl: false },
  { code: 'mk', name: 'Macedonian', nativeName: '??????????', rtl: false },
  { code: 'sr', name: 'Serbian', nativeName: '??????', rtl: false },
  { code: 'bs', name: 'Bosnian', nativeName: 'Bosanski', rtl: false },
  
  // Asian Languages
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '????', rtl: false },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '????', rtl: false },
  { code: 'ja', name: 'Japanese', nativeName: '???', rtl: false },
  { code: 'ko', name: 'Korean', nativeName: '???', rtl: false },
  { code: 'th', name: 'Thai', nativeName: '???', rtl: false },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Ti?ng Vi?t', rtl: false },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', rtl: false },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', rtl: false },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', rtl: false },
  { code: 'lo', name: 'Lao', nativeName: '???', rtl: false },
  { code: 'my', name: 'Burmese', nativeName: '??????', rtl: false },
  { code: 'km', name: 'Khmer', nativeName: '?????', rtl: false },
  { code: 'ne', name: 'Nepali', nativeName: '??????', rtl: false },
  { code: 'si', name: 'Sinhala', nativeName: '?????', rtl: false },
  
  // Middle Eastern & African Languages
  { code: 'ar', name: 'Arabic', nativeName: '???????', rtl: true },
  { code: 'he', name: 'Hebrew', nativeName: '?????', rtl: true },
  { code: 'fa', name: 'Persian', nativeName: '?????', rtl: true },
  { code: 'tr', name: 'Turkish', nativeName: 'T?rk?e', rtl: false },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', rtl: false },
  { code: 'am', name: 'Amharic', nativeName: '????', rtl: false },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa', rtl: false },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yor?b?', rtl: false },
  { code: 'ig', name: 'Igbo', nativeName: 'Igbo', rtl: false },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu', rtl: false },
  { code: 'xh', name: 'Xhosa', nativeName: 'isiXhosa', rtl: false },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', rtl: false },
  
  // Other Languages
  { code: 'az', name: 'Azerbaijani', nativeName: 'Az?rbaycan', rtl: false },
  { code: 'kk', name: 'Kazakh', nativeName: '?????', rtl: false },
  { code: 'uz', name: 'Uzbek', nativeName: 'O?zbek', rtl: false },
  { code: 'ka', name: 'Georgian', nativeName: '???????', rtl: false },
  { code: 'hy', name: 'Armenian', nativeName: '???????', rtl: false },
  { code: 'mn', name: 'Mongolian', nativeName: '??????', rtl: false },
  { code: 'ps', name: 'Pashto', nativeName: '????', rtl: true }
];

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
  isPremium: false,
  planName: 'Free',
  vfUsage: createEmptyVfUsageStats(),
  wallet: createEmptyWalletStats(),
  limits: {
    maxCharsPerGeneration: 8000,
    allowedEngines: ['DUNO', 'VECTOR'],
  },
  features: {
    earlyAccess: false,
  },
};

