export interface VectorMultiSpeakerDemoCastMember {
  speaker: string;
  role: string;
  displayName: string;
  voiceId: string;
  voiceGender: string;
  lineCount: number;
}

export interface VectorMultiSpeakerDemoLine {
  lineIndex: number;
  speaker: string;
  role: string;
  displayName: string;
  voiceId: string;
  voiceGender: string;
  text: string;
}

export interface VectorMultiSpeakerDemoEntry {
  id: string;
  language: string;
  languageCode: string;
  resolvedLanguage: string;
  market: string;
  useCase: string;
  scenario: string;
  direction: string;
  summary: string;
  translation: string;
  castSummary: string;
  cast: VectorMultiSpeakerDemoCastMember[];
  audioSrc: string;
  lines: VectorMultiSpeakerDemoLine[];
  rtl?: boolean;
}

export const VECTOR_MULTI_SPEAKER_DEMO_ENGINE = 'VECTOR Voice Engine';
export const VECTOR_MULTI_SPEAKER_DEMO_SELECTION_NOTE = 'Five high-reach language demos for podcast roundtables, spoken briefings, documentary cuts, and multi-speaker audiobooks.';
export const VECTOR_MULTI_SPEAKER_DEMO_GENERATED_AT = '2026-03-28T15:21:43.310Z';

export const VECTOR_MULTI_SPEAKER_DEMO_ENTRIES: VectorMultiSpeakerDemoEntry[] = [
  {
    "id": "en-roundtable",
    "language": "English (US)",
    "languageCode": "en-US",
    "resolvedLanguage": "en-US",
    "market": "United States / Global English",
    "useCase": "Podcast",
    "scenario": "Creator roundtable",
    "direction": "Three distinct speakers with quick handoffs, bright pacing, and a confident close.",
    "summary": "A three-speaker podcast opener built for roundtables, co-hosted shows, and premium creator discussions.",
    "translation": "A host opens the episode, a strategist explains why cast separation lifts retention, and a producer closes with the publishing payoff.",
    "castSummary": "Host: Ethan US Male + Strategist: Ava US Female + Producer: Grace UK Elder",
    "cast": [
      {
        "speaker": "Host",
        "role": "Host",
        "displayName": "Ethan US Male",
        "voiceId": "Alnilam",
        "voiceGender": "Male",
        "lineCount": 2
      },
      {
        "speaker": "Strategist",
        "role": "Strategist",
        "displayName": "Ava US Female",
        "voiceId": "Leda",
        "voiceGender": "Female",
        "lineCount": 2
      },
      {
        "speaker": "Producer",
        "role": "Producer",
        "displayName": "Grace UK Elder",
        "voiceId": "Laomedeia",
        "voiceGender": "Female",
        "lineCount": 2
      }
    ],
    "audioSrc": "/demo/vector-multi/en-roundtable.wav",
    "lines": [
      {
        "lineIndex": 0,
        "speaker": "Host",
        "role": "Host",
        "displayName": "Ethan US Male",
        "voiceId": "Alnilam",
        "voiceGender": "Male",
        "text": "Welcome back to Creator Signal. Tonight we are opening with the question that matters most: what makes a multilingual show feel premium from the very first line?"
      },
      {
        "lineIndex": 1,
        "speaker": "Strategist",
        "role": "Strategist",
        "displayName": "Ava US Female",
        "voiceId": "Leda",
        "voiceGender": "Female",
        "text": "It starts with contrast. Distinct speakers make the story feel intentional, and the listener instantly knows who is steering the moment."
      },
      {
        "lineIndex": 2,
        "speaker": "Producer",
        "role": "Producer",
        "displayName": "Grace UK Elder",
        "voiceId": "Laomedeia",
        "voiceGender": "Female",
        "text": "That clarity also makes clipping and translation cleaner, because every handoff is already mapped in the master script."
      },
      {
        "lineIndex": 3,
        "speaker": "Host",
        "role": "Host",
        "displayName": "Ethan US Male",
        "voiceId": "Alnilam",
        "voiceGender": "Male",
        "text": "So the benefit is retention, not just polish?"
      },
      {
        "lineIndex": 4,
        "speaker": "Strategist",
        "role": "Strategist",
        "displayName": "Ava US Female",
        "voiceId": "Leda",
        "voiceGender": "Female",
        "text": "Exactly. A sharp three-voice cast keeps the conversation easy to follow and gives the whole episode more momentum."
      },
      {
        "lineIndex": 5,
        "speaker": "Producer",
        "role": "Producer",
        "displayName": "Grace UK Elder",
        "voiceId": "Laomedeia",
        "voiceGender": "Female",
        "text": "And once the direction is locked, we can publish the same episode across markets without rebuilding the performance."
      }
    ]
  },
  {
    "id": "zh-briefing",
    "language": "Chinese (Simplified)",
    "languageCode": "zh-CN",
    "resolvedLanguage": "zh-CN",
    "market": "Mainland China / Global Mandarin",
    "useCase": "Briefing",
    "scenario": "Daily creator briefing",
    "direction": "Measured presenter lead with clean reporter handoffs and a calm analytic finish.",
    "summary": "A three-speaker Mandarin briefing that separates anchor, correspondent, and analyst roles for easier listening.",
    "translation": "An anchor opens the briefing, a correspondent reports on audio trends, and an analyst explains why multi-speaker structure improves clarity.",
    "castSummary": "Anchor: Noir Novel Artist + Correspondent: Lyris Novel Artist + Analyst: Yui Japan Female",
    "cast": [
      {
        "speaker": "Anchor",
        "role": "Anchor",
        "displayName": "Noir Novel Artist",
        "voiceId": "Orus",
        "voiceGender": "Male",
        "lineCount": 2
      },
      {
        "speaker": "Correspondent",
        "role": "Correspondent",
        "displayName": "Lyris Novel Artist",
        "voiceId": "Pulcherrima",
        "voiceGender": "Female",
        "lineCount": 2
      },
      {
        "speaker": "Analyst",
        "role": "Analyst",
        "displayName": "Yui Japan Female",
        "voiceId": "Despina",
        "voiceGender": "Female",
        "lineCount": 2
      }
    ],
    "audioSrc": "/demo/vector-multi/zh-briefing.wav",
    "lines": [
      {
        "lineIndex": 0,
        "speaker": "Anchor",
        "role": "Anchor",
        "displayName": "Noir Novel Artist",
        "voiceId": "Orus",
        "voiceGender": "Male",
        "text": "大家好，欢迎来到今日简报。今天我们先从音频创作里最值得关注的变化说起。"
      },
      {
        "lineIndex": 1,
        "speaker": "Correspondent",
        "role": "Correspondent",
        "displayName": "Lyris Novel Artist",
        "voiceId": "Pulcherrima",
        "voiceGender": "Female",
        "text": "我来补充一点：把主持、记者和分析师分开，能让听众更快抓住重点，也更容易保持专注。"
      },
      {
        "lineIndex": 2,
        "speaker": "Analyst",
        "role": "Analyst",
        "displayName": "Yui Japan Female",
        "voiceId": "Despina",
        "voiceGender": "Female",
        "text": "而且这种结构特别适合多语言发布，因为每一段职责都非常清楚。"
      },
      {
        "lineIndex": 3,
        "speaker": "Anchor",
        "role": "Anchor",
        "displayName": "Noir Novel Artist",
        "voiceId": "Orus",
        "voiceGender": "Male",
        "text": "这样会不会让内容听起来更有层次，也更高级？"
      },
      {
        "lineIndex": 4,
        "speaker": "Correspondent",
        "role": "Correspondent",
        "displayName": "Lyris Novel Artist",
        "voiceId": "Pulcherrima",
        "voiceGender": "Female",
        "text": "会的。清晰的分工，会让整个节目更像一部节奏分明的纪录片。"
      },
      {
        "lineIndex": 5,
        "speaker": "Analyst",
        "role": "Analyst",
        "displayName": "Yui Japan Female",
        "voiceId": "Despina",
        "voiceGender": "Female",
        "text": "对制作团队来说也更高效，因为角色和语气在剧本阶段就已经确定好了。"
      }
    ]
  },
  {
    "id": "hi-audiobook",
    "language": "Hindi",
    "languageCode": "hi-IN",
    "resolvedLanguage": "hi-IN",
    "market": "India",
    "useCase": "Audiobook",
    "scenario": "Family mystery scene",
    "direction": "Cinematic narration, intimate dialogue, and a low dramatic finish from a third speaker.",
    "summary": "A three-speaker Hindi audiobook scene built for dialogue-heavy fiction and premium serialized storytelling.",
    "translation": "A narrator sets the scene, Asha hears movement in the mansion, and her father pushes the mystery forward.",
    "castSummary": "Narrator: Arjun India Male + Asha: Meera India Female + Father: Adi India Boy",
    "cast": [
      {
        "speaker": "Narrator",
        "role": "Narrator",
        "displayName": "Arjun India Male",
        "voiceId": "Fenrir",
        "voiceGender": "Male",
        "lineCount": 2
      },
      {
        "speaker": "Asha",
        "role": "Asha",
        "displayName": "Meera India Female",
        "voiceId": "Kore",
        "voiceGender": "Female",
        "lineCount": 2
      },
      {
        "speaker": "Father",
        "role": "Father",
        "displayName": "Adi India Boy",
        "voiceId": "Achird",
        "voiceGender": "Male",
        "lineCount": 2
      }
    ],
    "audioSrc": "/demo/vector-multi/hi-audiobook.wav",
    "lines": [
      {
        "lineIndex": 0,
        "speaker": "Narrator",
        "role": "Narrator",
        "displayName": "Arjun India Male",
        "voiceId": "Fenrir",
        "voiceGender": "Male",
        "text": "नमस्ते, आज का दृश्य शांत है, लेकिन भीतर छिपा रहस्य हर पल और गहरा होता जा रहा है।"
      },
      {
        "lineIndex": 1,
        "speaker": "Asha",
        "role": "Asha",
        "displayName": "Meera India Female",
        "voiceId": "Kore",
        "voiceGender": "Female",
        "text": "मां, मुझे ऊपर से कोई हल्की आवाज़ सुनाई दी... क्या कोई वहां है?"
      },
      {
        "lineIndex": 2,
        "speaker": "Father",
        "role": "Father",
        "displayName": "Adi India Boy",
        "voiceId": "Achird",
        "voiceGender": "Male",
        "text": "घबराओ मत, हम धीरे-धीरे देखेंगे। पहले रोशनी संभालो और मेरे पीछे चलो।"
      },
      {
        "lineIndex": 3,
        "speaker": "Narrator",
        "role": "Narrator",
        "displayName": "Arjun India Male",
        "voiceId": "Fenrir",
        "voiceGender": "Male",
        "text": "उस क्षण हवा और भी ठंडी लगने लगी, जैसे घर ने अपने राज़ को रोककर रखा हो।"
      },
      {
        "lineIndex": 4,
        "speaker": "Asha",
        "role": "Asha",
        "displayName": "Meera India Female",
        "voiceId": "Kore",
        "voiceGender": "Female",
        "text": "अगर मैं पीछे रहूं तो क्या आप पहले अंदर देखेंगे?"
      },
      {
        "lineIndex": 5,
        "speaker": "Father",
        "role": "Father",
        "displayName": "Adi India Boy",
        "voiceId": "Achird",
        "voiceGender": "Male",
        "text": "बिल्कुल। एक-एक कदम करके चलेंगे, और इस रहस्य को साथ मिलकर सुलझाएंगे."
      }
    ]
  },
  {
    "id": "es-culture",
    "language": "Spanish",
    "languageCode": "es-ES",
    "resolvedLanguage": "es-ES",
    "market": "Spain / Latin America",
    "useCase": "Podcast",
    "scenario": "Culture recap panel",
    "direction": "Conversational host lead, warm critic analysis, and a crisp production-minded wrap.",
    "summary": "A three-speaker Spanish culture segment designed for podcasts, recap channels, and story-led creator formats.",
    "translation": "A host opens with a festival story, a critic adds social context, and a producer explains why the format localizes well.",
    "castSummary": "Host: Mateo Spain Male + Critic: Valentina Spain Female + Producer: Lucas Brazil Male",
    "cast": [
      {
        "speaker": "Host",
        "role": "Host",
        "displayName": "Mateo Spain Male",
        "voiceId": "Zephyr",
        "voiceGender": "Male",
        "lineCount": 2
      },
      {
        "speaker": "Critic",
        "role": "Critic",
        "displayName": "Valentina Spain Female",
        "voiceId": "Callirrhoe",
        "voiceGender": "Female",
        "lineCount": 2
      },
      {
        "speaker": "Producer",
        "role": "Producer",
        "displayName": "Lucas Brazil Male",
        "voiceId": "Algenib",
        "voiceGender": "Male",
        "lineCount": 2
      }
    ],
    "audioSrc": "/demo/vector-multi/es-culture.wav",
    "lines": [
      {
        "lineIndex": 0,
        "speaker": "Host",
        "role": "Host",
        "displayName": "Mateo Spain Male",
        "voiceId": "Zephyr",
        "voiceGender": "Male",
        "text": "Bienvenidos a Voces de la Ciudad; hoy abrimos con la historia detrás del festival que volvió a llenar las plazas."
      },
      {
        "lineIndex": 1,
        "speaker": "Critic",
        "role": "Critic",
        "displayName": "Valentina Spain Female",
        "voiceId": "Callirrhoe",
        "voiceGender": "Female",
        "text": "Lo más interesante es que no fue solo un concierto, sino una mezcla de memoria, barrio y nuevas audiencias."
      },
      {
        "lineIndex": 2,
        "speaker": "Producer",
        "role": "Producer",
        "displayName": "Lucas Brazil Male",
        "voiceId": "Algenib",
        "voiceGender": "Male",
        "text": "Por eso el episodio funciona mejor con tres voces: una guía la escena, otra aporta contexto y la tercera deja el cierre listo para publicación."
      },
      {
        "lineIndex": 3,
        "speaker": "Host",
        "role": "Host",
        "displayName": "Mateo Spain Male",
        "voiceId": "Zephyr",
        "voiceGender": "Male",
        "text": "¿También ayuda cuando adaptamos el programa para otros países?"
      },
      {
        "lineIndex": 4,
        "speaker": "Critic",
        "role": "Critic",
        "displayName": "Valentina Spain Female",
        "voiceId": "Callirrhoe",
        "voiceGender": "Female",
        "text": "Muchísimo. Cuando cada intervención es clara, el relato se siente más cercano y más cinematográfico."
      },
      {
        "lineIndex": 5,
        "speaker": "Producer",
        "role": "Producer",
        "displayName": "Lucas Brazil Male",
        "voiceId": "Algenib",
        "voiceGender": "Male",
        "text": "Y para el equipo, la localización sale más rápida porque el reparto ya está definido desde el guion."
      }
    ]
  },
  {
    "id": "ar-documentary",
    "language": "Arabic",
    "languageCode": "ar-AE",
    "resolvedLanguage": "ar-AE",
    "market": "Middle East / North Africa",
    "useCase": "Documentary",
    "scenario": "Historic city feature",
    "direction": "Low cinematic narration with warm expert commentary and a deliberate archival close.",
    "summary": "A three-speaker Arabic documentary passage showing how narration, expert context, and archive detail can stay distinct.",
    "translation": "A narrator introduces the old city, a historian adds context, and an archivist explains why clear cast separation matters for multilingual releases.",
    "castSummary": "Narrator: Omar UAE Male + Historian: Leila UAE Female + Archivist: Hans Germany Male",
    "cast": [
      {
        "speaker": "Narrator",
        "role": "Narrator",
        "displayName": "Omar UAE Male",
        "voiceId": "Sulafat",
        "voiceGender": "Male",
        "lineCount": 2
      },
      {
        "speaker": "Historian",
        "role": "Historian",
        "displayName": "Leila UAE Female",
        "voiceId": "Umbriel",
        "voiceGender": "Female",
        "lineCount": 2
      },
      {
        "speaker": "Archivist",
        "role": "Archivist",
        "displayName": "Hans Germany Male",
        "voiceId": "Rasalgethi",
        "voiceGender": "Male",
        "lineCount": 2
      }
    ],
    "audioSrc": "/demo/vector-multi/ar-documentary.wav",
    "lines": [
      {
        "lineIndex": 0,
        "speaker": "Narrator",
        "role": "Narrator",
        "displayName": "Omar UAE Male",
        "voiceId": "Sulafat",
        "voiceGender": "Male",
        "text": "هنا تبدأ الحكاية؛ المدينة القديمة تستيقظ، ويملأ الضوء أزقتها الحجرية بهدوءٍ مهيب."
      },
      {
        "lineIndex": 1,
        "speaker": "Historian",
        "role": "Historian",
        "displayName": "Leila UAE Female",
        "voiceId": "Umbriel",
        "voiceGender": "Female",
        "text": "ما يهمني هنا هو أن الصوت الأول يجب أن يكون واضحًا جدًا، حتى لا تضيع تفاصيل الرحلة."
      },
      {
        "lineIndex": 2,
        "speaker": "Archivist",
        "role": "Archivist",
        "displayName": "Hans Germany Male",
        "voiceId": "Rasalgethi",
        "voiceGender": "Male",
        "text": "ولهذا نعتمد على توزيع الأدوار: الراوي يفتح المشهد، والمؤرخ يضيف السياق، والأرشيفي يثبت التفاصيل."
      },
      {
        "lineIndex": 3,
        "speaker": "Narrator",
        "role": "Narrator",
        "displayName": "Omar UAE Male",
        "voiceId": "Sulafat",
        "voiceGender": "Male",
        "text": "هل ترى كيف يصبح السرد أقوى عندما نسمع أكثر من طبقة واحدة؟"
      },
      {
        "lineIndex": 4,
        "speaker": "Historian",
        "role": "Historian",
        "displayName": "Leila UAE Female",
        "voiceId": "Umbriel",
        "voiceGender": "Female",
        "text": "بالتأكيد، فالتنظيم الواضح يجعل القصة أقرب إلى فيلم وثائقي سينمائي."
      },
      {
        "lineIndex": 5,
        "speaker": "Archivist",
        "role": "Archivist",
        "displayName": "Hans Germany Male",
        "voiceId": "Rasalgethi",
        "voiceGender": "Male",
        "text": "وعندما يكون كل صوت في مكانه، تصبح الترجمة والنشر في أسواق متعددة أسهل بكثير."
      }
    ],
    "rtl": true
  }
];
