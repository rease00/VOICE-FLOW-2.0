export interface VectorDemoAudioEntry {
  id: string;
  language: string;
  languageCode: string;
  resolvedLanguage: string;
  country: string;
  scenario: string;
  emotion: string;
  style: string;
  translation: string;
  script: string;
  displayName: string;
  voiceId: string;
  voiceGender: string;
  audioSrc: string;
  rtl?: boolean;
}

export const VECTOR_DEMO_AUDIO_ENGINE = 'VECTOR Voice Engine';
export const VECTOR_DEMO_AUDIO_VOICE = 'AI-Directed Mixed Cast';
export const VECTOR_DEMO_AUDIO_GENERATED_AT = '2026-03-28T11:23:41.186Z';

export const VECTOR_DEMO_AUDIO_ENTRIES: VectorDemoAudioEntry[] = [
  {
    "id": "en-us",
    "language": "English (US)",
    "languageCode": "en-US",
    "resolvedLanguage": "en-US",
    "country": "United States",
    "scenario": "Funding win",
    "emotion": "Excited",
    "style": "upbeat, energetic, clear",
    "translation": "I can't believe we actually got the funding! This is amazing news!",
    "script": "I can't believe we actually got the funding! This is amazing news!",
    "displayName": "Ethan US Male",
    "voiceId": "Alnilam",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/en-us.wav"
  },
  {
    "id": "hi",
    "language": "Hindi",
    "languageCode": "hi-IN",
    "resolvedLanguage": "hi-IN",
    "country": "India",
    "scenario": "Comforting a friend",
    "emotion": "Warm",
    "style": "gentle, empathetic, soothing",
    "translation": "Don't worry, everything will be alright. I'm here for you.",
    "script": "घबराइए मत, सब ठीक हो जाएगा। मैं हूं ना, आपके साथ।",
    "displayName": "Arjun India Male",
    "voiceId": "Fenrir",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/hi.wav"
  },
  {
    "id": "bn",
    "language": "Bengali",
    "languageCode": "bn-IN",
    "resolvedLanguage": "bn-IN",
    "country": "Bangladesh / India",
    "scenario": "Family travel memory",
    "emotion": "Joyful",
    "style": "nostalgic, cheerful, light",
    "translation": "Remember that trip to Cox's Bazar? We had so much fun!",
    "script": "আরে দারুণ! চলুন আজকের এই ভ্রমণের গল্পটা হাসিমুখে মনে করি!",
    "displayName": "Meera India Female",
    "voiceId": "Kore",
    "voiceGender": "Female",
    "audioSrc": "/demo/vector/bn.wav"
  },
  {
    "id": "ta",
    "language": "Tamil",
    "languageCode": "ta-IN",
    "resolvedLanguage": "ta-IN",
    "country": "India / Sri Lanka",
    "scenario": "Encouraging a friend",
    "emotion": "Hopeful",
    "style": "encouraging, positive, gentle",
    "translation": "You can do this! Just give it your best shot.",
    "script": "நீங்கள் இதை நிச்சயமாக செய்யலாம்! முழு நம்பிக்கையுடன் முன்னேறுங்கள்.",
    "displayName": "Arjun India Male",
    "voiceId": "Fenrir",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/ta.wav"
  },
  {
    "id": "es",
    "language": "Spanish",
    "languageCode": "es-ES",
    "resolvedLanguage": "es-ES",
    "country": "Spain",
    "scenario": "Friendly directions",
    "emotion": "Curious",
    "style": "polite, friendly, inquisitive",
    "translation": "Excuse me, could you tell me how to get to the nearest metro station?",
    "script": "Disculpe, ¿podría decirme cómo llegar a la estación de metro más cercana?",
    "displayName": "Mateo Spain Male",
    "voiceId": "Zephyr",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/es.wav"
  },
  {
    "id": "fr",
    "language": "French",
    "languageCode": "fr-FR",
    "resolvedLanguage": "fr-FR",
    "country": "France",
    "scenario": "Loved the meal",
    "emotion": "Joyful",
    "style": "content, appreciative, light",
    "translation": "This meal is absolutely delicious! Thank you so much.",
    "script": "Ce repas est absolument délicieux ! Merci beaucoup, c'est vraiment parfait.",
    "displayName": "Pierre France Male",
    "voiceId": "Sadaltager",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/fr.wav"
  },
  {
    "id": "de",
    "language": "German",
    "languageCode": "de-DE",
    "resolvedLanguage": "de-DE",
    "country": "Germany",
    "scenario": "Meeting confirmation",
    "emotion": "Confident",
    "style": "clear, direct, professional",
    "translation": "Yes, we are confirmed for the meeting at 3 PM tomorrow.",
    "script": "Ja, wir sind für das Treffen morgen um 15 Uhr bestätigt. Alles ist vorbereitet.",
    "displayName": "Hans Germany Male",
    "voiceId": "Rasalgethi",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/de.wav"
  },
  {
    "id": "it",
    "language": "Italian",
    "languageCode": "it-IT",
    "resolvedLanguage": "it-IT",
    "country": "Italy",
    "scenario": "Rome trip hype",
    "emotion": "Excited",
    "style": "enthusiastic, lively, eager",
    "translation": "I'm so excited for our trip to Rome next week! It's going to be incredible.",
    "script": "Sono davvero emozionata per il nostro viaggio a Roma la prossima settimana! Sarà incredibile.",
    "displayName": "Emily UK Female",
    "voiceId": "Autonoe",
    "voiceGender": "Female",
    "audioSrc": "/demo/vector/it.wav"
  },
  {
    "id": "pt-br",
    "language": "Portuguese (Brazil)",
    "languageCode": "pt-BR",
    "resolvedLanguage": "pt-BR",
    "country": "Brazil",
    "scenario": "Neighborly help",
    "emotion": "Warm",
    "style": "friendly, helpful, approachable",
    "translation": "Hi! Do you need any help with those groceries?",
    "script": "Oi! Precisa de ajuda com essas compras? Posso levar algumas sacolas para você.",
    "displayName": "Arjun India Male",
    "voiceId": "Fenrir",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/pt-br.wav"
  },
  {
    "id": "ar",
    "language": "Arabic",
    "languageCode": "ar-AE",
    "resolvedLanguage": "ar-AE",
    "country": "United Arab Emirates",
    "scenario": "Gift gratitude",
    "emotion": "Joyful",
    "style": "grateful, sincere, warm",
    "translation": "Thank you so much for this wonderful gift! It is exactly what I wanted.",
    "script": "مرحبًا! شكرًا جزيلًا على هذه الهدية الرائعة. لقد أسعدتني كثيرًا.",
    "displayName": "Omar UAE Male",
    "voiceId": "Sulafat",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/ar.wav",
    "rtl": true
  },
  {
    "id": "ru",
    "language": "Russian",
    "languageCode": "ru-RU",
    "resolvedLanguage": "ru-RU",
    "country": "Russia",
    "scenario": "Calm reassurance",
    "emotion": "Reassuring",
    "style": "calm, supportive, steady",
    "translation": "Don't worry, we'll figure this out together. Take your time.",
    "script": "Не волнуйтесь, мы обязательно разберёмся вместе. У вас всё получится.",
    "displayName": "Ivan Russia Male",
    "voiceId": "Vindemiatrix",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/ru.wav"
  },
  {
    "id": "tr",
    "language": "Turkish",
    "languageCode": "tr-TR",
    "resolvedLanguage": "tr-TR",
    "country": "Turkey",
    "scenario": "Concert anticipation",
    "emotion": "Excited",
    "style": "eager, enthusiastic, lively",
    "translation": "I can't wait for the concert tonight! It's going to be fantastic.",
    "script": "Bu akşamki konseri sabırsızlıkla bekliyorum! Gerçekten harika olacak.",
    "displayName": "Noir Novel Artist",
    "voiceId": "Orus",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/tr.wav"
  },
  {
    "id": "ja",
    "language": "Japanese",
    "languageCode": "ja-JP",
    "resolvedLanguage": "ja-JP",
    "country": "Japan",
    "scenario": "Polite clarification",
    "emotion": "Curious",
    "style": "polite, inquisitive, gentle",
    "translation": "Excuse me, could you please explain that part again?",
    "script": "すみません、もう一度その部分をゆっくり説明していただけますか？",
    "displayName": "Kenji Japan Male",
    "voiceId": "Achernar",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/ja.wav"
  },
  {
    "id": "ko",
    "language": "Korean",
    "languageCode": "ko-KR",
    "resolvedLanguage": "ko-KR",
    "country": "South Korea",
    "scenario": "Hopeful future",
    "emotion": "Hopeful",
    "style": "optimistic, gentle, sincere",
    "translation": "I believe things will get better soon. Let us stay positive.",
    "script": "괜찮아요. 천천히 해도 돼요. 제가 옆에서 끝까지 도와드릴게요。",
    "displayName": "Noir Novel Artist",
    "voiceId": "Orus",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/ko.wav"
  },
  {
    "id": "zh",
    "language": "Chinese (Simplified)",
    "languageCode": "zh-CN",
    "resolvedLanguage": "zh-CN",
    "country": "China",
    "scenario": "Promotion news",
    "emotion": "Joyful",
    "style": "happy, warm, clear",
    "translation": "Guess what? I got the promotion! I am so happy!",
    "script": "太好了！我真的升职了，这太令人开心了！",
    "displayName": "Kenji Japan Male",
    "voiceId": "Achernar",
    "voiceGender": "Male",
    "audioSrc": "/demo/vector/zh.wav"
  }
];
