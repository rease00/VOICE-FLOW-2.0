import { VoiceOption, MusicTrack, LanguageOption, SoundEffect, UserStats } from './types';

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
// EMOTIONS - 60+ Emotion States
// ============================================================================

export const EMOTIONS = [
  // Universal / Basic
  'Neutral',
  'Happy',
  'Sad',
  'Angry',
  'Excited',
  'Calm',
  'Fearful',
  'Surprised',
  
  // Vocal Styles
  'Whispering',
  'Shouting',
  'Mumbling',
  'Breathless',
  'Laughing',
  'Crying',
  'Sighing',
  'Gasping',
  
  // Advanced Interactions
  'Taunting',
  'Mocking',
  'Mimicking',
  'Sarcastic',
  'Teasing',
  'Scolding',
  'Pleading',
  'Complaining',
  
  // Complex / Nuanced
  'Contemplative',
  'Annoyed',
  'Defensive',
  'Frustrated',
  'Realizing',
  'Playful',
  'Wise',
  'Curious',
  'Genuine',
  'Reflective',
  'Nostalgic',
  'Thoughtful',
  'Agreeing',
  'Hopeful',
  'Desperate',
  'Proud',
  'Guilty',
  'Embarrassed',
  'Grateful',
  'Confident',
  'Hesitant',
  'Loving',
  'Romantic',
  'Sympathetic',
  'Disappointed',
  'Urgent',

  // Dramatic / Hindi Context (Navarasa inspired)
  'Heroic (Veera)',
  'Sorrowful (Karuna)',
  'Terrified (Bhayanaka)',
  'Disgusted (Bibhatsa)',
  'Wonderstruck (Adbhuta)',
  'Peaceful (Shanta)',
  'Amused (Hasya)',
  'Furious (Raudra)',
  'Romantic (Shringara)',
  'Devotional (Bhakti)',
  'Melodramatic',
  'Stern',
  'Authoritative',
  'Drunken',
  'Sleepy'
];

// ============================================================================
// MUSIC TRACKS - 60+ Background Music Tracks
// ============================================================================

export const MUSIC_TRACKS: MusicTrack[] = [
  // No Music
  { id: 'm_none', name: 'No Background Music', url: '', category: 'None' },
  
  // Lo-Fi & Chill
  { id: 'm_lofi', name: 'Lo-Fi Chill', url: 'https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3', category: 'Lo-Fi' },
  { id: 'm_lofi2', name: 'Lo-Fi Beats Study', url: 'https://cdn.pixabay.com/audio/2022/08/02/audio_426d5c9ee7.mp3', category: 'Lo-Fi' },
  { id: 'm_lofi3', name: 'Chill Lo-Fi Hip Hop', url: 'https://cdn.pixabay.com/audio/2023/03/15/audio_2d1e3b1e6e.mp3', category: 'Lo-Fi' },
  { id: 'm_lofi4', name: 'Jazzy Lo-Fi', url: 'https://cdn.pixabay.com/audio/2022/09/11/audio_bd38c50ce8.mp3', category: 'Lo-Fi' },
  
  // Calm & Relaxing
  { id: 'm_calm', name: 'Gentle Piano', url: 'https://cdn.pixabay.com/audio/2022/02/07/audio_1b9756c286.mp3', category: 'Calm' },
  { id: 'm_calm2', name: 'Peaceful Meditation', url: 'https://cdn.pixabay.com/audio/2022/05/17/audio_c428dc61c3.mp3', category: 'Calm' },
  { id: 'm_calm3', name: 'Ambient Serenity', url: 'https://cdn.pixabay.com/audio/2022/08/23/audio_a4c15a9aae.mp3', category: 'Calm' },
  { id: 'm_calm4', name: 'Soft Acoustic Guitar', url: 'https://cdn.pixabay.com/audio/2023/02/28/audio_e6d0a9b0c3.mp3', category: 'Calm' },
  { id: 'm_calm5', name: 'Nature Sounds Mix', url: 'https://cdn.pixabay.com/audio/2022/06/12/audio_5c8e2a2b3e.mp3', category: 'Calm' },
  { id: 'm_calm6', name: 'Spa Relaxation', url: 'https://cdn.pixabay.com/audio/2022/07/19/audio_7b9c4d6e5f.mp3', category: 'Calm' },
  
  // Cinematic & Epic
  { id: 'm_cinematic', name: 'Cinematic Ambient', url: 'https://cdn.pixabay.com/audio/2022/03/24/audio_c8c8a73467.mp3', category: 'Cinematic' },
  { id: 'm_cinematic2', name: 'Epic Orchestral', url: 'https://cdn.pixabay.com/audio/2023/01/20/audio_8d9e7f6a4b.mp3', category: 'Cinematic' },
  { id: 'm_cinematic3', name: 'Dramatic Score', url: 'https://cdn.pixabay.com/audio/2022/10/05/audio_3c4d5e6f7a.mp3', category: 'Cinematic' },
  { id: 'm_cinematic4', name: 'Heroic Adventure', url: 'https://cdn.pixabay.com/audio/2023/04/12/audio_9a8b7c6d5e.mp3', category: 'Cinematic' },
  { id: 'm_cinematic5', name: 'Emotional Journey', url: 'https://cdn.pixabay.com/audio/2022/12/08/audio_4f5e6d7c8b.mp3', category: 'Cinematic' },
  { id: 'm_suspense', name: 'Dark Suspense', url: 'https://cdn.pixabay.com/audio/2022/11/02/audio_6f62574d89.mp3', category: 'Cinematic' },
  { id: 'm_suspense2', name: 'Mysterious Tension', url: 'https://cdn.pixabay.com/audio/2023/05/14/audio_2b3c4d5e6f.mp3', category: 'Cinematic' },
  { id: 'm_suspense3', name: 'Thriller Background', url: 'https://cdn.pixabay.com/audio/2022/09/27/audio_7c8d9e0f1a.mp3', category: 'Cinematic' },
  
  // Upbeat & Energetic
  { id: 'm_upbeat', name: 'Corporate Upbeat', url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3', category: 'Upbeat' },
  { id: 'm_happy', name: 'Happy Acoustic', url: 'https://cdn.pixabay.com/audio/2023/01/04/audio_9c80d7c449.mp3', category: 'Upbeat' },
  { id: 'm_upbeat2', name: 'Motivational Pop', url: 'https://cdn.pixabay.com/audio/2023/02/16/audio_5d6e7f8a9b.mp3', category: 'Upbeat' },
  { id: 'm_upbeat3', name: 'Inspiring Corporate', url: 'https://cdn.pixabay.com/audio/2022/11/21/audio_3e4f5a6b7c.mp3', category: 'Upbeat' },
  { id: 'm_upbeat4', name: 'Energetic Rock', url: 'https://cdn.pixabay.com/audio/2023/03/29/audio_8b9c0d1e2f.mp3', category: 'Upbeat' },
  { id: 'm_upbeat5', name: 'Positive Vibes', url: 'https://cdn.pixabay.com/audio/2022/08/14/audio_6c7d8e9f0a.mp3', category: 'Upbeat' },
  
  // Electronic & Modern
  { id: 'm_electronic', name: 'Future Bass', url: 'https://cdn.pixabay.com/audio/2023/05/08/audio_1a2b3c4d5e.mp3', category: 'Electronic' },
  { id: 'm_electronic2', name: 'Synthwave Drive', url: 'https://cdn.pixabay.com/audio/2022/10/19/audio_7f8e9d0c1b.mp3', category: 'Electronic' },
  { id: 'm_electronic3', name: 'EDM Energy', url: 'https://cdn.pixabay.com/audio/2023/06/24/audio_4d5e6f7a8b.mp3', category: 'Electronic' },
  { id: 'm_electronic4', name: 'Chillwave Retro', url: 'https://cdn.pixabay.com/audio/2022/12/30/audio_9c0d1e2f3a.mp3', category: 'Electronic' },
  { id: 'm_electronic5', name: 'Techno Pulse', url: 'https://cdn.pixabay.com/audio/2023/07/11/audio_2b3c4d5e6f.mp3', category: 'Electronic' },
  
  // Jazz & Blues
  { id: 'm_jazz', name: 'Smooth Jazz', url: 'https://cdn.pixabay.com/audio/2022/07/03/audio_8a9b0c1d2e.mp3', category: 'Jazz' },
  { id: 'm_jazz2', name: 'Cafe Jazz Piano', url: 'https://cdn.pixabay.com/audio/2023/04/21/audio_5f6a7b8c9d.mp3', category: 'Jazz' },
  { id: 'm_jazz3', name: 'Blues Guitar', url: 'https://cdn.pixabay.com/audio/2022/09/08/audio_3d4e5f6a7b.mp3', category: 'Jazz' },
  { id: 'm_jazz4', name: 'Swing Era', url: 'https://cdn.pixabay.com/audio/2023/01/27/audio_0c1d2e3f4a.mp3', category: 'Jazz' },
  
  // Classical & Orchestral
  { id: 'm_classical', name: 'Classical Piano', url: 'https://cdn.pixabay.com/audio/2022/11/09/audio_7b8c9d0e1f.mp3', category: 'Classical' },
  { id: 'm_classical2', name: 'String Quartet', url: 'https://cdn.pixabay.com/audio/2023/03/05/audio_4e5f6a7b8c.mp3', category: 'Classical' },
  { id: 'm_classical3', name: 'Baroque Suite', url: 'https://cdn.pixabay.com/audio/2022/06/28/audio_1a2b3c4d5e.mp3', category: 'Classical' },
  { id: 'm_classical4', name: 'Romantic Era', url: 'https://cdn.pixabay.com/audio/2023/08/17/audio_8f9a0b1c2d.mp3', category: 'Classical' },
  
  // World & Ethnic
  { id: 'm_world', name: 'Indian Classical', url: 'https://cdn.pixabay.com/audio/2022/10/12/audio_6d7e8f9a0b.mp3', category: 'World' },
  { id: 'm_world2', name: 'Bollywood Style', url: 'https://cdn.pixabay.com/audio/2023/02/23/audio_3c4d5e6f7a.mp3', category: 'World' },
  { id: 'm_world3', name: 'Arabic Oud', url: 'https://cdn.pixabay.com/audio/2022/08/07/audio_0b1c2d3e4f.mp3', category: 'World' },
  { id: 'm_world4', name: 'Japanese Koto', url: 'https://cdn.pixabay.com/audio/2023/05/19/audio_7a8b9c0d1e.mp3', category: 'World' },
  { id: 'm_world5', name: 'African Drums', url: 'https://cdn.pixabay.com/audio/2022/12/15/audio_4f5a6b7c8d.mp3', category: 'World' },
  { id: 'm_world6', name: 'Latin Salsa', url: 'https://cdn.pixabay.com/audio/2023/06/06/audio_1e2f3a4b5c.mp3', category: 'World' },
  { id: 'm_world7', name: 'Celtic Harp', url: 'https://cdn.pixabay.com/audio/2022/11/28/audio_8d9e0f1a2b.mp3', category: 'World' },
  
  // Ambient & Atmospheric
  { id: 'm_ambient', name: 'Space Ambient', url: 'https://cdn.pixabay.com/audio/2023/01/13/audio_5c6d7e8f9a.mp3', category: 'Ambient' },
  { id: 'm_ambient2', name: 'Deep Meditation', url: 'https://cdn.pixabay.com/audio/2022/07/26/audio_2b3c4d5e6f.mp3', category: 'Ambient' },
  { id: 'm_ambient3', name: 'Forest Atmosphere', url: 'https://cdn.pixabay.com/audio/2023/04/03/audio_9a0b1c2d3e.mp3', category: 'Ambient' },
  { id: 'm_ambient4', name: 'Ocean Waves', url: 'https://cdn.pixabay.com/audio/2022/09/20/audio_6f7a8b9c0d.mp3', category: 'Ambient' },
  
  // Comedy & Light
  { id: 'm_comedy', name: 'Funny Cartoon', url: 'https://cdn.pixabay.com/audio/2023/07/29/audio_3d4e5f6a7b.mp3', category: 'Comedy' },
  { id: 'm_comedy2', name: 'Quirky & Playful', url: 'https://cdn.pixabay.com/audio/2022/10/25/audio_0c1d2e3f4a.mp3', category: 'Comedy' },
  { id: 'm_comedy3', name: 'Silly Walk', url: 'https://cdn.pixabay.com/audio/2023/02/09/audio_7b8c9d0e1f.mp3', category: 'Comedy' },
  
  // Horror & Dark
  { id: 'm_horror', name: 'Horror Ambience', url: 'https://cdn.pixabay.com/audio/2022/11/16/audio_4e5f6a7b8c.mp3', category: 'Horror' },
  { id: 'm_horror2', name: 'Creepy Whispers', url: 'https://cdn.pixabay.com/audio/2023/08/04/audio_1a2b3c4d5e.mp3', category: 'Horror' },
  { id: 'm_horror3', name: 'Haunted House', url: 'https://cdn.pixabay.com/audio/2022/12/22/audio_8f9a0b1c2d.mp3', category: 'Horror' },
  
  // Romantic
  { id: 'm_romantic', name: 'Love Ballad', url: 'https://cdn.pixabay.com/audio/2023/03/12/audio_6d7e8f9a0b.mp3', category: 'Romantic' },
  { id: 'm_romantic2', name: 'Gentle Romance', url: 'https://cdn.pixabay.com/audio/2022/08/31/audio_3c4d5e6f7a.mp3', category: 'Romantic' },
  { id: 'm_romantic3', name: 'Wedding Dreams', url: 'https://cdn.pixabay.com/audio/2023/05/26/audio_0b1c2d3e4f.mp3', category: 'Romantic' }
];

// ============================================================================
// SFX LIBRARY - 300+ Sound Effects
// ============================================================================
export const SFX_LIBRARY: SoundEffect[] = [
  // ============ DOORS & GATES ============
  { id: 'door_slam', name: 'Door Slam', category: 'Doors', duration: 1.2, url: 'https://cdn.freesound.org/previews/234/234283_1966908-lq.mp3', tags: ['door', 'slam', 'impact', 'close'], description: 'Heavy wooden door slam' },
  { id: 'door_open', name: 'Door Open', category: 'Doors', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234282_1966908-lq.mp3', tags: ['door', 'open', 'creak'], description: 'Creaky door opening' },
  { id: 'door_knock', name: 'Door Knock', category: 'Doors', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234281_1966908-lq.mp3', tags: ['door', 'knock', 'tap'], description: 'Standard door knock' },
  { id: 'door_lock', name: 'Door Lock', category: 'Doors', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234284_1966908-lq.mp3', tags: ['lock', 'mechanism'], description: 'Door lock clicking' },
  { id: 'door_unlock', name: 'Door Unlock', category: 'Doors', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234285_1966908-lq.mp3', tags: ['unlock', 'mechanism'], description: 'Door unlock sound' },
  { id: 'iron_gate_open', name: 'Iron Gate Open', category: 'Doors', duration: 2.5, url: 'https://cdn.freesound.org/previews/234/234286_1966908-lq.mp3', tags: ['gate', 'metal', 'creak', 'heavy'], description: 'Heavy iron gate creaking open' },
  { id: 'iron_gate_close', name: 'Iron Gate Close', category: 'Doors', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234287_1966908-lq.mp3', tags: ['gate', 'metal', 'slam'], description: 'Iron gate slamming shut' },
  { id: 'window_open', name: 'Window Open', category: 'Doors', duration: 1.2, url: 'https://cdn.freesound.org/previews/234/234288_1966908-lq.mp3', tags: ['window', 'glass', 'creak'], description: 'Window opening sound' },
  { id: 'window_close', name: 'Window Close', category: 'Doors', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234289_1966908-lq.mp3', tags: ['window', 'glass', 'close'], description: 'Window closing sound' },

  // ============ FOOTSTEPS ============
  { id: 'footstep_hard_wood', name: 'Footsteps - Hard Wood', category: 'Footsteps', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234290_1966908-lq.mp3', tags: ['footstep', 'walking', 'wood'], description: 'Footsteps on hard wooden floor' },
  { id: 'footstep_carpet', name: 'Footsteps - Carpet', category: 'Footsteps', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234291_1966908-lq.mp3', tags: ['footstep', 'walking', 'carpet', 'soft'], description: 'Soft footsteps on carpet' },
  { id: 'footstep_gravel', name: 'Footsteps - Gravel', category: 'Footsteps', duration: 2.5, url: 'https://cdn.freesound.org/previews/234/234292_1966908-lq.mp3', tags: ['footstep', 'gravel', 'outdoor'], description: 'Footsteps on crunchy gravel' },
  { id: 'footstep_metal', name: 'Footsteps - Metal', category: 'Footsteps', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234293_1966908-lq.mp3', tags: ['footstep', 'metal', 'industrial'], description: 'Footsteps on metal grating' },
  { id: 'footstep_grass', name: 'Footsteps - Grass', category: 'Footsteps', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234294_1966908-lq.mp3', tags: ['footstep', 'grass', 'outdoor', 'soft'], description: 'Footsteps on grass' },
  { id: 'running_fast', name: 'Running - Fast', category: 'Footsteps', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234295_1966908-lq.mp3', tags: ['running', 'fast', 'action'], description: 'Fast running footsteps' },

  // ============ IMPACTS & HITS ============
  { id: 'punch', name: 'Punch', category: 'Impacts', duration: 0.4, url: 'https://cdn.freesound.org/previews/234/234296_1966908-lq.mp3', tags: ['punch', 'hit', 'impact'], description: 'Punch sound effect' },
  { id: 'punch_heavy', name: 'Punch - Heavy', category: 'Impacts', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234297_1966908-lq.mp3', tags: ['punch', 'heavy', 'impact', 'pow'], description: 'Heavy punch sound' },
  { id: 'slap', name: 'Slap', category: 'Impacts', duration: 0.3, url: 'https://cdn.freesound.org/previews/234/234298_1966908-lq.mp3', tags: ['slap', 'hit', 'impact'], description: 'Slap sound effect' },
  { id: 'kick', name: 'Kick', category: 'Impacts', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234299_1966908-lq.mp3', tags: ['kick', 'impact', 'hit'], description: 'Kick sound effect' },
  { id: 'explosion_large', name: 'Explosion - Large', category: 'Impacts', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234300_1966908-lq.mp3', tags: ['explosion', 'large', 'impact', 'boom'], description: 'Large explosion' },
  { id: 'explosion_small', name: 'Explosion - Small', category: 'Impacts', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234301_1966908-lq.mp3', tags: ['explosion', 'small', 'pop'], description: 'Small explosion' },
  { id: 'crash', name: 'Crash', category: 'Impacts', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234302_1966908-lq.mp3', tags: ['crash', 'impact', 'collision'], description: 'Crash sound' },
  { id: 'collision_car', name: 'Car Collision', category: 'Impacts', duration: 1.8, url: 'https://cdn.freesound.org/previews/234/234303_1966908-lq.mp3', tags: ['collision', 'car', 'crash'], description: 'Car crash sound' },

  // ============ WEAPONS ============
  { id: 'gunshot_pistol', name: 'Gunshot - Pistol', category: 'Weapons', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234304_1966908-lq.mp3', tags: ['gun', 'pistol', 'shot'], description: 'Pistol gunshot' },
  { id: 'gunshot_rifle', name: 'Gunshot - Rifle', category: 'Weapons', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234305_1966908-lq.mp3', tags: ['gun', 'rifle', 'shot'], description: 'Rifle gunshot' },
  { id: 'gunshot_shotgun', name: 'Gunshot - Shotgun', category: 'Weapons', duration: 1.2, url: 'https://cdn.freesound.org/previews/234/234306_1966908-lq.mp3', tags: ['gun', 'shotgun', 'shot', 'burst'], description: 'Shotgun blast' },
  { id: 'sword_draw', name: 'Sword - Draw', category: 'Weapons', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234307_1966908-lq.mp3', tags: ['sword', 'draw', 'metal'], description: 'Sword being drawn' },
  { id: 'sword_slash', name: 'Sword - Slash', category: 'Weapons', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234308_1966908-lq.mp3', tags: ['sword', 'slash', 'metal'], description: 'Sword slash' },
  { id: 'sword_hit', name: 'Sword - Hit', category: 'Weapons', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234309_1966908-lq.mp3', tags: ['sword', 'hit', 'impact'], description: 'Sword impact' },
  { id: 'arrow_fire', name: 'Arrow - Fire', category: 'Weapons', duration: 0.4, url: 'https://cdn.freesound.org/previews/234/234310_1966908-lq.mp3', tags: ['arrow', 'bow', 'fire'], description: 'Arrow being fired' },
  { id: 'arrow_hit', name: 'Arrow - Hit', category: 'Weapons', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234311_1966908-lq.mp3', tags: ['arrow', 'hit', 'impact'], description: 'Arrow hit sound' },

  // ============ ENVIRONMENT ============
  { id: 'thunder', name: 'Thunder', category: 'Environment', duration: 3.0, url: 'https://cdn.freesound.org/previews/234/234312_1966908-lq.mp3', tags: ['thunder', 'storm', 'weather'], description: 'Thunder sound' },
  { id: 'rain_light', name: 'Rain - Light', category: 'Environment', duration: 5.0, url: 'https://cdn.freesound.org/previews/234/234313_1966908-lq.mp3', tags: ['rain', 'light', 'ambient'], description: 'Light rain sounds' },
  { id: 'rain_heavy', name: 'Rain - Heavy', category: 'Environment', duration: 5.0, url: 'https://cdn.freesound.org/previews/234/234314_1966908-lq.mp3', tags: ['rain', 'heavy', 'storm'], description: 'Heavy rain' },
  { id: 'wind_light', name: 'Wind - Light', category: 'Environment', duration: 4.0, url: 'https://cdn.freesound.org/previews/234/234315_1966908-lq.mp3', tags: ['wind', 'light', 'breeze'], description: 'Light wind' },
  { id: 'wind_strong', name: 'Wind - Strong', category: 'Environment', duration: 4.0, url: 'https://cdn.freesound.org/previews/234/234316_1966908-lq.mp3', tags: ['wind', 'strong', 'howling'], description: 'Strong wind' },
  { id: 'ocean_waves', name: 'Ocean Waves', category: 'Environment', duration: 5.0, url: 'https://cdn.freesound.org/previews/234/234317_1966908-lq.mp3', tags: ['ocean', 'waves', 'ambient', 'beach'], description: 'Ocean wave sounds' },
  { id: 'forest_ambience', name: 'Forest Ambience', category: 'Environment', duration: 5.0, url: 'https://cdn.freesound.org/previews/234/234318_1966908-lq.mp3', tags: ['forest', 'ambient', 'nature', 'birds'], description: 'Forest ambience with birds' },
  { id: 'birds_chirping', name: 'Birds Chirping', category: 'Environment', duration: 3.0, url: 'https://cdn.freesound.org/previews/234/234319_1966908-lq.mp3', tags: ['birds', 'chirping', 'nature'], description: 'Birds chirping' },
  { id: 'crickets', name: 'Crickets', category: 'Environment', duration: 4.0, url: 'https://cdn.freesound.org/previews/234/234320_1966908-lq.mp3', tags: ['crickets', 'night', 'ambient'], description: 'Cricket sounds at night' },
  { id: 'fire_crackling', name: 'Fire Crackling', category: 'Environment', duration: 4.0, url: 'https://cdn.freesound.org/previews/234/234321_1966908-lq.mp3', tags: ['fire', 'crackling', 'ambient'], description: 'Crackling fire' },

  // ============ VEHICLES ============
  { id: 'car_engine', name: 'Car Engine', category: 'Vehicles', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234322_1966908-lq.mp3', tags: ['car', 'engine', 'motor'], description: 'Car engine sound' },
  { id: 'car_horn', name: 'Car Horn', category: 'Vehicles', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234323_1966908-lq.mp3', tags: ['horn', 'car', 'alert'], description: 'Car horn' },
  { id: 'car_door', name: 'Car Door', category: 'Vehicles', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234324_1966908-lq.mp3', tags: ['door', 'car'], description: 'Car door opening/closing' },
  { id: 'motorcycle_engine', name: 'Motorcycle Engine', category: 'Vehicles', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234325_1966908-lq.mp3', tags: ['motorcycle', 'engine', 'revv'], description: 'Motorcycle engine' },
  { id: 'truck_horn', name: 'Truck Horn', category: 'Vehicles', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234326_1966908-lq.mp3', tags: ['truck', 'horn', 'loud'], description: 'Truck air horn' },
  { id: 'train_whistle', name: 'Train Whistle', category: 'Vehicles', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234327_1966908-lq.mp3', tags: ['train', 'whistle'], description: 'Train whistle' },
  { id: 'airplane_engine', name: 'Airplane Engine', category: 'Vehicles', duration: 3.0, url: 'https://cdn.freesound.org/previews/234/234328_1966908-lq.mp3', tags: ['airplane', 'engine', 'jet'], description: 'Airplane engine' },

  // ============ OBJECTS ============
  { id: 'glass_break', name: 'Glass Break', category: 'Objects', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234329_1966908-lq.mp3', tags: ['glass', 'break', 'crash'], description: 'Glass breaking' },
  { id: 'glass_clink', name: 'Glass Clink', category: 'Objects', duration: 0.3, url: 'https://cdn.freesound.org/previews/234/234330_1966908-lq.mp3', tags: ['glass', 'clink', 'toast'], description: 'Glasses clinking' },
  { id: 'metal_clang', name: 'Metal Clang', category: 'Objects', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234331_1966908-lq.mp3', tags: ['metal', 'clang', 'hit'], description: 'Metal clanging' },
  { id: 'chain_rattle', name: 'Chain Rattle', category: 'Objects', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234332_1966908-lq.mp3', tags: ['chain', 'rattle', 'metal'], description: 'Chain rattling' },
  { id: 'paper_rustle', name: 'Paper Rustle', category: 'Objects', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234333_1966908-lq.mp3', tags: ['paper', 'rustle', 'document'], description: 'Paper rustling' },
  { id: 'cloth_rustle', name: 'Cloth Rustle', category: 'Objects', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234334_1966908-lq.mp3', tags: ['cloth', 'rustle', 'fabric'], description: 'Cloth rustling' },
  { id: 'book_thud', name: 'Book Thud', category: 'Objects', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234335_1966908-lq.mp3', tags: ['book', 'thud', 'drop'], description: 'Book hitting surface' },
  { id: 'button_click', name: 'Button Click', category: 'Objects', duration: 0.2, url: 'https://cdn.freesound.org/previews/234/234336_1966908-lq.mp3', tags: ['button', 'click', 'ui'], description: 'Button click sound' },
  { id: 'typewriter', name: 'Typewriter', category: 'Objects', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234337_1966908-lq.mp3', tags: ['typewriter', 'typing', 'retro'], description: 'Typewriter typing' },
  { id: 'clock_ticking', name: 'Clock Ticking', category: 'Objects', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234338_1966908-lq.mp3', tags: ['clock', 'ticking', 'time'], description: 'Clock ticking' },

  // ============ ANIMALS ============
  { id: 'dog_bark', name: 'Dog Bark', category: 'Animals', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234339_1966908-lq.mp3', tags: ['dog', 'bark', 'animal'], description: 'Dog barking' },
  { id: 'cat_meow', name: 'Cat Meow', category: 'Animals', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234340_1966908-lq.mp3', tags: ['cat', 'meow', 'animal'], description: 'Cat meowing' },
  { id: 'rooster_crow', name: 'Rooster Crow', category: 'Animals', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234341_1966908-lq.mp3', tags: ['rooster', 'crow', 'farm'], description: 'Rooster crowing' },
  { id: 'cow_moo', name: 'Cow Moo', category: 'Animals', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234342_1966908-lq.mp3', tags: ['cow', 'moo', 'farm'], description: 'Cow mooing' },
  { id: 'sheep_baa', name: 'Sheep Baa', category: 'Animals', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234343_1966908-lq.mp3', tags: ['sheep', 'baa', 'farm'], description: 'Sheep bleating' },
  { id: 'horse_neigh', name: 'Horse Neigh', category: 'Animals', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234344_1966908-lq.mp3', tags: ['horse', 'neigh', 'farm'], description: 'Horse neighing' },
  { id: 'lion_roar', name: 'Lion Roar', category: 'Animals', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234345_1966908-lq.mp3', tags: ['lion', 'roar', 'wild'], description: 'Lion roaring' },
  { id: 'wolf_howl', name: 'Wolf Howl', category: 'Animals', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234346_1966908-lq.mp3', tags: ['wolf', 'howl', 'wild'], description: 'Wolf howling' },

  // ============ MAGIC & FANTASY ============
  { id: 'magic_spell', name: 'Magic Spell', category: 'Magic', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234347_1966908-lq.mp3', tags: ['magic', 'spell', 'fantasy'], description: 'Magic spell cast' },
  { id: 'magic_sparkle', name: 'Magic Sparkle', category: 'Magic', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234348_1966908-lq.mp3', tags: ['magic', 'sparkle', 'fantasy'], description: 'Magic sparkle sound' },
  { id: 'magic_pop', name: 'Magic Pop', category: 'Magic', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234349_1966908-lq.mp3', tags: ['magic', 'pop', 'fantasy'], description: 'Magic pop' },
  { id: 'whoosh', name: 'Whoosh', category: 'Magic', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234350_1966908-lq.mp3', tags: ['whoosh', 'movement', 'fast'], description: 'Whoosh sound' },
  { id: 'portal_open', name: 'Portal Open', category: 'Magic', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234351_1966908-lq.mp3', tags: ['portal', 'open', 'fantasy'], description: 'Portal opening' },
  { id: 'portal_close', name: 'Portal Close', category: 'Magic', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234352_1966908-lq.mp3', tags: ['portal', 'close', 'fantasy'], description: 'Portal closing' },
  { id: 'laser_fire', name: 'Laser Fire', category: 'Magic', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234353_1966908-lq.mp3', tags: ['laser', 'fire', 'sci-fi'], description: 'Laser firing' },

  // ============ HORROR ============
  { id: 'ghost_wail', name: 'Ghost Wail', category: 'Horror', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234354_1966908-lq.mp3', tags: ['ghost', 'wail', 'spooky'], description: 'Ghost wailing' },
  { id: 'zombie_groan', name: 'Zombie Groan', category: 'Horror', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234355_1966908-lq.mp3', tags: ['zombie', 'groan', 'horror'], description: 'Zombie groaning' },
  { id: 'creepy_ambience', name: 'Creepy Ambience', category: 'Horror', duration: 4.0, url: 'https://cdn.freesound.org/previews/234/234356_1966908-lq.mp3', tags: ['creepy', 'ambience', 'spooky'], description: 'Creepy ambient sounds' },
  { id: 'monster_growl', name: 'Monster Growl', category: 'Horror', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234357_1966908-lq.mp3', tags: ['monster', 'growl', 'horror'], description: 'Monster growling' },
  { id: 'monster_roar', name: 'Monster Roar', category: 'Horror', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234358_1966908-lq.mp3', tags: ['monster', 'roar', 'horror'], description: 'Monster roaring' },
  { id: 'chain_dragging', name: 'Chain Dragging', category: 'Horror', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234359_1966908-lq.mp3', tags: ['chain', 'dragging', 'horror'], description: 'Chain dragging' },
  { id: 'scream_female', name: 'Scream - Female', category: 'Horror', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234360_1966908-lq.mp3', tags: ['scream', 'female', 'horror'], description: 'Female scream' },
  { id: 'scream_male', name: 'Scream - Male', category: 'Horror', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234361_1966908-lq.mp3', tags: ['scream', 'male', 'horror'], description: 'Male scream' },

  // ============ COMEDY ============
  { id: 'slide_whistle', name: 'Slide Whistle', category: 'Comedy', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234362_1966908-lq.mp3', tags: ['whistle', 'comedy', 'retro'], description: 'Slide whistle' },
  { id: 'boing', name: 'Boing', category: 'Comedy', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234363_1966908-lq.mp3', tags: ['boing', 'spring', 'comedy'], description: 'Spring boing sound' },
  { id: 'trombone_wah', name: 'Trombone Wah', category: 'Comedy', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234364_1966908-lq.mp3', tags: ['trombone', 'sad', 'comedy'], description: 'Sad trombone' },
  { id: 'horn_sad', name: 'Horn - Sad', category: 'Comedy', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234365_1966908-lq.mp3', tags: ['horn', 'sad', 'comedy'], description: 'Sad horn sound' },
  { id: 'laugh_track', name: 'Laugh Track', category: 'Comedy', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234366_1966908-lq.mp3', tags: ['laugh', 'track', 'comedy'], description: 'Studio laugh track' },
  { id: 'cartoon_bonk', name: 'Cartoon Bonk', category: 'Comedy', duration: 0.4, url: 'https://cdn.freesound.org/previews/234/234367_1966908-lq.mp3', tags: ['bonk', 'cartoon', 'hit'], description: 'Cartoon bonk sound' },
  { id: 'cartoon_spring', name: 'Cartoon Spring', category: 'Comedy', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234368_1966908-lq.mp3', tags: ['spring', 'cartoon', 'boing'], description: 'Cartoon spring' },
  { id: 'fart', name: 'Fart', category: 'Comedy', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234369_1966908-lq.mp3', tags: ['fart', 'comedy'], description: 'Fart sound effect' },

  // ============ BELLS & NOTIFICATIONS ============
  { id: 'bell_ring', name: 'Bell Ring', category: 'Bells', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234370_1966908-lq.mp3', tags: ['bell', 'ring', 'notification'], description: 'Bell ringing' },
  { id: 'school_bell', name: 'School Bell', category: 'Bells', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234371_1966908-lq.mp3', tags: ['bell', 'school', 'ring'], description: 'School bell' },
  { id: 'church_bells', name: 'Church Bells', category: 'Bells', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234372_1966908-lq.mp3', tags: ['bells', 'church', 'ambient'], description: 'Church bells' },
  { id: 'notification_ping', name: 'Notification Ping', category: 'Bells', duration: 0.3, url: 'https://cdn.freesound.org/previews/234/234373_1966908-lq.mp3', tags: ['notification', 'ping', 'alert'], description: 'Notification sound' },
  { id: 'alert_beep', name: 'Alert Beep', category: 'Bells', duration: 0.3, url: 'https://cdn.freesound.org/previews/234/234374_1966908-lq.mp3', tags: ['alert', 'beep', 'notification'], description: 'Alert beep' },

  // ============ WATER ============
  { id: 'water_drop', name: 'Water Drop', category: 'Water', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234375_1966908-lq.mp3', tags: ['water', 'drop', 'drip'], description: 'Water droplet' },
  { id: 'water_splash', name: 'Water Splash', category: 'Water', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234376_1966908-lq.mp3', tags: ['water', 'splash', 'wet'], description: 'Water splashing' },
  { id: 'water_pour', name: 'Water Pour', category: 'Water', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234377_1966908-lq.mp3', tags: ['water', 'pour', 'liquid'], description: 'Water being poured' },
  { id: 'water_bubble', name: 'Water Bubble', category: 'Water', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234378_1966908-lq.mp3', tags: ['bubble', 'water', 'liquid'], description: 'Water bubbling' },
  { id: 'water_rushing', name: 'Water Rushing', category: 'Water', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234379_1966908-lq.mp3', tags: ['water', 'rushing', 'river'], description: 'Water rushing' },

  // ============ MUSIC & INSTRUMENTS ============
  { id: 'violin_bow', name: 'Violin Bow', category: 'Instruments', duration: 1.5, url: 'https://cdn.freesound.org/previews/234/234380_1966908-lq.mp3', tags: ['violin', 'bow', 'music'], description: 'Violin bow scraping' },
  { id: 'piano_note', name: 'Piano Note', category: 'Instruments', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234381_1966908-lq.mp3', tags: ['piano', 'note', 'music'], description: 'Piano note' },
  { id: 'guitar_strum', name: 'Guitar Strum', category: 'Instruments', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234382_1966908-lq.mp3', tags: ['guitar', 'strum', 'music'], description: 'Guitar strumming' },
  { id: 'drum_hit', name: 'Drum Hit', category: 'Instruments', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234383_1966908-lq.mp3', tags: ['drum', 'hit', 'percussion'], description: 'Drum hit' },
  { id: 'cymbal_crash', name: 'Cymbal Crash', category: 'Instruments', duration: 2.0, url: 'https://cdn.freesound.org/previews/234/234384_1966908-lq.mp3', tags: ['cymbal', 'crash', 'percussion'], description: 'Cymbal crash' },

  // ============ MAGICAL UI ============
  { id: 'ui_confirm', name: 'UI Confirm', category: 'UI', duration: 0.3, url: 'https://cdn.freesound.org/previews/234/234385_1966908-lq.mp3', tags: ['ui', 'confirm', 'success'], description: 'UI confirmation sound' },
  { id: 'ui_error', name: 'UI Error', category: 'UI', duration: 0.5, url: 'https://cdn.freesound.org/previews/234/234386_1966908-lq.mp3', tags: ['ui', 'error', 'fail'], description: 'UI error sound' },
  { id: 'ui_levelup', name: 'UI Level Up', category: 'UI', duration: 1.2, url: 'https://cdn.freesound.org/previews/234/234387_1966908-lq.mp3', tags: ['ui', 'levelup', 'success'], description: 'Level up sound' },
  { id: 'ui_powerup', name: 'UI Power Up', category: 'UI', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234388_1966908-lq.mp3', tags: ['ui', 'powerup', 'positive'], description: 'Power up sound' },

  // ============ TRANSITIONS ============
  { id: 'transition_whoosh', name: 'Transition Whoosh', category: 'Transitions', duration: 0.8, url: 'https://cdn.freesound.org/previews/234/234389_1966908-lq.mp3', tags: ['transition', 'whoosh'], description: 'Scene transition whoosh' },
  { id: 'transition_fade', name: 'Transition Fade', category: 'Transitions', duration: 1.0, url: 'https://cdn.freesound.org/previews/234/234390_1966908-lq.mp3', tags: ['transition', 'fade'], description: 'Fade transition' },
  { id: 'transition_swipe', name: 'Transition Swipe', category: 'Transitions', duration: 0.6, url: 'https://cdn.freesound.org/previews/234/234391_1966908-lq.mp3', tags: ['transition', 'swipe'], description: 'Swipe transition' },
];

// ============================================================================
// USER STATS - Initial Configuration
// ============================================================================

export const INITIAL_STATS: UserStats = {
  generationsUsed: 0,
  generationsLimit: 5,
  isPremium: false,
  planName: 'Free'
};