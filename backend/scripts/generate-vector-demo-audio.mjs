#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const CWD = process.cwd();
const ROOT = await (async () => {
  try {
    await fs.access(path.join(CWD, 'frontend'));
    return CWD;
  } catch {
    return path.resolve(CWD, '..');
  }
})();

const RUNTIME_BASE_URL = String(
  process.env.VF_VECTOR_RUNTIME_URL || process.env.VF_GEM_RUNTIME_URL || 'http://127.0.0.1:7810',
)
  .trim()
  .replace(/\/+$/, '');
const RUNTIME_SYNTHESIZE_URL = `${RUNTIME_BASE_URL}/synthesize`;
const OUTPUT_DIR = path.join(ROOT, 'frontend', 'public', 'demo', 'vector');
const MANIFEST_PATH = path.join(ROOT, 'frontend', 'src', 'landing', 'vectorDemoAudioManifest.ts');
const VOICE_MAP_PATH = path.join(ROOT, 'backend', 'config', 'voice_id_map.v1.json');
const PROFILE_BANK_PATH = path.join(ROOT, 'backend', 'config', 'voice_profile_bank.v1.json');
const REQUEST_TIMEOUT_MS = Math.max(10_000, Number(process.env.VF_VECTOR_DEMO_TIMEOUT_MS || 120_000));
const MAX_RETRIES = Math.max(1, Number(process.env.VF_VECTOR_DEMO_RETRIES || 4));

const DEMO_ENTRIES = [
  {
    id: 'en-us',
    language: 'English (US)',
    country: 'United States',
    languageCandidates: ['en-US', 'en'],
    scenario: 'Funding win',
    emotion: 'Excited',
    style: 'upbeat, energetic, clear',
    translation: "I can't believe we actually got the funding! This is amazing news!",
    script: "I can't believe we actually got the funding! This is amazing news!",
    voicePool: ['Alnilam', 'Leda', 'Enceladus', 'Erinome', 'Puck', 'Charon'],
  },
  {
    id: 'hi',
    language: 'Hindi',
    country: 'India',
    languageCandidates: ['hi-IN', 'hi'],
    scenario: 'Comforting a friend',
    emotion: 'Warm',
    style: 'gentle, empathetic, soothing',
    translation: "Don't worry, everything will be alright. I'm here for you.",
    script: 'घबराइए मत, सब ठीक हो जाएगा। मैं हूं ना, आपके साथ।',
    voicePool: ['Fenrir', 'Kore', 'Achird', 'Aoede', 'Gacrux'],
  },
  {
    id: 'bn',
    language: 'Bengali',
    country: 'Bangladesh / India',
    languageCandidates: ['bn-IN', 'bn-BD', 'bn'],
    scenario: 'Family travel memory',
    emotion: 'Joyful',
    style: 'nostalgic, cheerful, light',
    translation: "Remember that trip to Cox's Bazar? We had so much fun!",
    script: 'আরে দারুণ! চলুন আজকের এই ভ্রমণের গল্পটা হাসিমুখে মনে করি!',
    voicePool: ['Fenrir', 'Kore', 'Achird', 'Aoede', 'Gacrux'],
  },
  {
    id: 'ta',
    language: 'Tamil',
    country: 'India / Sri Lanka',
    languageCandidates: ['ta-IN', 'ta-LK', 'ta'],
    scenario: 'Encouraging a friend',
    emotion: 'Hopeful',
    style: 'encouraging, positive, gentle',
    translation: 'You can do this! Just give it your best shot.',
    script: 'நீங்கள் இதை நிச்சயமாக செய்யலாம்! முழு நம்பிக்கையுடன் முன்னேறுங்கள்.',
    voicePool: ['Fenrir', 'Kore', 'Achird', 'Aoede', 'Gacrux'],
  },
  {
    id: 'es',
    language: 'Spanish',
    country: 'Spain',
    languageCandidates: ['es-ES', 'es'],
    scenario: 'Friendly directions',
    emotion: 'Curious',
    style: 'polite, friendly, inquisitive',
    translation: 'Excuse me, could you tell me how to get to the nearest metro station?',
    script: 'Disculpe, ¿podría decirme cómo llegar a la estación de metro más cercana?',
    voicePool: ['Zephyr', 'Callirrhoe'],
  },
  {
    id: 'fr',
    language: 'French',
    country: 'France',
    languageCandidates: ['fr-FR', 'fr'],
    scenario: 'Loved the meal',
    emotion: 'Joyful',
    style: 'content, appreciative, light',
    translation: 'This meal is absolutely delicious! Thank you so much.',
    script: 'Ce repas est absolument délicieux ! Merci beaucoup, c'est vraiment parfait.',
    voicePool: ['Sadaltager', 'Schedar'],
  },
  {
    id: 'de',
    language: 'German',
    country: 'Germany',
    languageCandidates: ['de-DE', 'de'],
    scenario: 'Meeting confirmation',
    emotion: 'Confident',
    style: 'clear, direct, professional',
    translation: 'Yes, we are confirmed for the meeting at 3 PM tomorrow.',
    script: 'Ja, wir sind für das Treffen morgen um 15 Uhr bestätigt. Alles ist vorbereitet.',
    voicePool: ['Rasalgethi', 'Sadachbia'],
  },
  {
    id: 'it',
    language: 'Italian',
    country: 'Italy',
    languageCandidates: ['it-IT', 'it'],
    scenario: 'Rome trip hype',
    emotion: 'Excited',
    style: 'enthusiastic, lively, eager',
    translation: "I'm so excited for our trip to Rome next week! It's going to be incredible.",
    script: 'Sono davvero emozionata per il nostro viaggio a Roma la prossima settimana! Sarà incredibile.',
    voicePool: ['Iapetus', 'Autonoe', 'Orus', 'Pulcherrima'],
  },
  {
    id: 'pt-br',
    language: 'Portuguese (Brazil)',
    country: 'Brazil',
    languageCandidates: ['pt-BR', 'pt'],
    scenario: 'Neighborly help',
    emotion: 'Warm',
    style: 'friendly, helpful, approachable',
    translation: 'Hi! Do you need any help with those groceries?',
    script: 'Oi! Precisa de ajuda com essas compras? Posso levar algumas sacolas para você.',
    voicePool: ['Algenib', 'Algieba'],
  },
  {
    id: 'ar',
    language: 'Arabic',
    country: 'United Arab Emirates',
    languageCandidates: ['ar-AE', 'ar-SA', 'ar'],
    scenario: 'Gift gratitude',
    emotion: 'Joyful',
    style: 'grateful, sincere, warm',
    translation: 'Thank you so much for this wonderful gift! It is exactly what I wanted.',
    script: 'مرحبًا! شكرًا جزيلًا على هذه الهدية الرائعة. لقد أسعدتني كثيرًا.',
    voicePool: ['Sulafat', 'Umbriel'],
    rtl: true,
  },
  {
    id: 'ru',
    language: 'Russian',
    country: 'Russia',
    languageCandidates: ['ru-RU', 'ru'],
    scenario: 'Calm reassurance',
    emotion: 'Reassuring',
    style: 'calm, supportive, steady',
    translation: "Don't worry, we'll figure this out together. Take your time.",
    script: 'Не волнуйтесь, мы обязательно разберёмся вместе. У вас всё получится.',
    voicePool: ['Vindemiatrix', 'Zubenelgenubi'],
  },
  {
    id: 'tr',
    language: 'Turkish',
    country: 'Turkey',
    languageCandidates: ['tr-TR', 'tr'],
    scenario: 'Concert anticipation',
    emotion: 'Excited',
    style: 'eager, enthusiastic, lively',
    translation: "I can't wait for the concert tonight! It's going to be fantastic.",
    script: 'Bu akşamki konseri sabırsızlıkla bekliyorum! Gerçekten harika olacak.',
    voicePool: ['Orus', 'Pulcherrima', 'Rasalgethi', 'Sadachbia'],
  },
  {
    id: 'ja',
    language: 'Japanese',
    country: 'Japan',
    languageCandidates: ['ja-JP', 'ja'],
    scenario: 'Polite clarification',
    emotion: 'Curious',
    style: 'polite, inquisitive, gentle',
    translation: 'Excuse me, could you please explain that part again?',
    script: 'すみません、もう一度その部分をゆっくり説明していただけますか？',
    voicePool: ['Achernar', 'Despina'],
  },
  {
    id: 'ko',
    language: 'Korean',
    country: 'South Korea',
    languageCandidates: ['ko-KR', 'ko'],
    scenario: 'Hopeful future',
    emotion: 'Hopeful',
    style: 'optimistic, gentle, sincere',
    translation: 'I believe things will get better soon. Let us stay positive.',
    script: '괜찮아요. 천천히 해도 돼요. 제가 옆에서 끝까지 도와드릴게요.',
    voicePool: ['Orus', 'Pulcherrima', 'Achernar', 'Despina'],
  },
  {
    id: 'zh',
    language: 'Chinese (Simplified)',
    country: 'China',
    languageCandidates: ['zh-CN', 'zh'],
    scenario: 'Promotion news',
    emotion: 'Joyful',
    style: 'happy, warm, clear',
    translation: 'Guess what? I got the promotion! I am so happy!',
    script: '太好了！我真的升职了，这太令人开心了！',
    voicePool: ['Orus', 'Pulcherrima', 'Achernar', 'Despina'],
  },
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (targetPath) => {
  const raw = await fs.readFile(targetPath, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const parseVoiceCatalog = async () => {
  const [payload, profileBank] = await Promise.all([readJson(VOICE_MAP_PATH), readJson(PROFILE_BANK_PATH)]);
  const voices = Array.isArray(payload?.engines?.PRIME?.runtimeVoices) ? payload.engines.PRIME.runtimeVoices : [];
  const voiceToProfile =
    payload?.engines?.PRIME?.voiceToProfile && typeof payload.engines.PRIME.voiceToProfile === 'object'
      ? payload.engines.PRIME.voiceToProfile
      : {};
  const profiles = new Map(
    (Array.isArray(profileBank?.profiles) ? profileBank.profiles : [])
      .filter((profile) => profile && typeof profile === 'object')
      .map((profile) => [String(profile.profileId || '').trim(), profile]),
  );
  return new Map(
    voices
      .map((entry) => {
        const runtimeVoiceName = String(entry.voice || '').trim();
        const runtimeVoiceId = String(entry.voice_id || '').trim();
        const profileId = String(voiceToProfile[runtimeVoiceName] || voiceToProfile[runtimeVoiceId] || '').trim();
        const profile = profiles.get(profileId);
        return [
          runtimeVoiceName,
          {
            voiceId: runtimeVoiceName,
            displayName: String(profile?.displayName || '').trim() || runtimeVoiceId || runtimeVoiceName,
            gender: String(profile?.gender || entry.gender || '').trim() || 'Unknown',
          },
        ];
      })
      .filter(([voiceName]) => voiceName.length > 0),
  );
};

const parseErrorDetail = async (response) => {
  const body = await response.text();
  if (!body) return `HTTP ${response.status}`;
  try {
    const json = JSON.parse(body);
    const detail = json?.detail || json?.error || json;
    return typeof detail === 'string' ? detail : JSON.stringify(detail);
  } catch {
    return body.slice(0, 400);
  }
};

const resolveRetryDelayMs = (detail, attempt) => {
  const retryAfterMs = Number(
    String(detail).match(/"retryAfterMs"\s*:\s*(\d+)/)?.[1] || 0,
  );
  return Math.max(2_000, retryAfterMs || attempt * 3_000);
};

const pickVoiceCandidates = ({ entry, voiceCatalog, previousVoice }) => {
  const eligibleVoices = entry.voicePool.filter((voice) => voiceCatalog.has(voice));
  const pool = (eligibleVoices.length ? eligibleVoices : Array.from(voiceCatalog.keys())).filter((voice) => voice !== previousVoice);
  const fallbackPool = Array.from(voiceCatalog.keys()).filter((voice) => voice !== previousVoice && !pool.includes(voice));
  const selectedVoices = [...pool, ...fallbackPool];
  if (!selectedVoices.length) {
    throw new Error(`No voice could be selected for ${entry.language}.`);
  }
  return selectedVoices
    .map((voiceName) => voiceCatalog.get(voiceName))
    .filter((voice) => Boolean(voice));
};

const synthesizeSample = async ({ entry, voices }) => {
  const attempts = [];
  for (const voice of voices) {
    for (const language of entry.languageCandidates) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        const payload = {
          engine: 'VECTOR',
          text: entry.script,
          language,
          voiceName: voice.voiceId,
          voice_id: voice.voiceId,
          voiceId: voice.voiceId,
          emotion: entry.emotion,
          style: entry.style,
          speed: 1,
          stream: false,
        };

        const response = await fetchWithTimeout(RUNTIME_SYNTHESIZE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'audio/wav',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const audioBytes = Buffer.from(await response.arrayBuffer());
          return { audioBytes, resolvedLanguage: language, voice };
        }

        const detail = await parseErrorDetail(response);
        attempts.push(`${voice.voiceId} ${language} attempt ${attempt}/${MAX_RETRIES}: ${detail}`);
        if (attempt < MAX_RETRIES && (response.status === 429 || response.status === 503)) {
          await pause(resolveRetryDelayMs(detail, attempt));
          continue;
        }
        await pause(250);
        break;
      }
    }
  }

  throw new Error(`Runtime synthesis failed for ${entry.language}. ${attempts.join(' | ')}`);
};

const renderManifestTs = (entries) => `export interface VectorDemoAudioEntry {
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

export const VECTOR_DEMO_AUDIO_ENGINE = 'Vector Voice Engine';
export const VECTOR_DEMO_AUDIO_VOICE = 'AI-Directed Mixed Cast';
export const VECTOR_DEMO_AUDIO_GENERATED_AT = '${new Date().toISOString()}';

export const VECTOR_DEMO_AUDIO_ENTRIES: VectorDemoAudioEntry[] = ${JSON.stringify(entries, null, 2)};
`;

const main = async () => {
  const voiceCatalog = await parseVoiceCatalog();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const manifestEntries = [];
  let previousVoice = '';

  console.log(`[vector-demo] runtime=${RUNTIME_SYNTHESIZE_URL}`);

  for (const entry of DEMO_ENTRIES) {
    const voices = pickVoiceCandidates({ entry, voiceCatalog, previousVoice });
    const { audioBytes, resolvedLanguage, voice } = await synthesizeSample({ entry, voices });
    const audioFileName = `${entry.id}.wav`;
    const audioRelativePath = `/demo/vector/${audioFileName}`;
    const targetPath = path.join(OUTPUT_DIR, audioFileName);
    await fs.writeFile(targetPath, audioBytes);
    previousVoice = voice.voiceId;

    manifestEntries.push({
      id: entry.id,
      language: entry.language,
      languageCode: entry.languageCandidates[0],
      resolvedLanguage,
      country: entry.country,
      scenario: entry.scenario,
      emotion: entry.emotion,
      style: entry.style,
      translation: entry.translation,
      script: entry.script,
      displayName: voice.displayName,
      voiceId: voice.voiceId,
      voiceGender: voice.gender,
      audioSrc: audioRelativePath,
      ...(entry.rtl ? { rtl: true } : {}),
    });

    console.log(
      `[vector-demo] ${entry.language} -> ${audioRelativePath} | language=${resolvedLanguage} | voice=${voice.displayName} | runtime=${voice.voiceId} | emotion=${entry.emotion}`,
    );

    await pause(1500);
  }

  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, renderManifestTs(manifestEntries), 'utf8');
  console.log(`[vector-demo] manifest written -> ${path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/')}`);
};

main().catch((error) => {
  console.error(`[vector-demo] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});