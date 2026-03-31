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
const OUTPUT_DIR = path.join(ROOT, 'frontend', 'public', 'audio', 'vector-multi-demo');
const MANIFEST_PATH = path.join(ROOT, 'frontend', 'public', 'audio', 'vector-multi-demo', 'manifest.json');
const VOICE_MAP_PATH = path.join(ROOT, 'backend', 'config', 'voice_id_map.v1.json');
const PROFILE_BANK_PATH = path.join(ROOT, 'backend', 'config', 'voice_profile_bank.v1.json');
const REQUEST_TIMEOUT_MS = Math.max(10_000, Number(process.env.VF_VECTOR_DEMO_TIMEOUT_MS || 120_000));
const MAX_RETRIES = Math.max(1, Number(process.env.VF_VECTOR_DEMO_RETRIES || 4));

const DEMO_ENTRIES = [
  {
    id: 'en-roundtable',
    language: 'English (US)',
    market: 'United States / Global English',
    languageCandidates: ['en-US', 'en'],
    useCase: 'Podcast',
    scenario: 'Creator roundtable',
    direction: 'Three distinct speakers with quick handoffs, bright pacing, and a confident close.',
    summary: 'A three-speaker podcast opener built for roundtables, co-hosted shows, and premium creator discussions.',
    translation: 'A host opens the episode, a strategist explains why cast separation lifts retention, and a producer closes with the publishing payoff.',
    voiceCast: {
      Host: 'Alnilam',
      Strategist: 'Leda',
      Producer: 'Laomedeia',
    },
    lines: [
      {
        speaker: 'Host',
        role: 'Host',
        text: 'Welcome back to Creator Signal. Tonight we are opening with the question that matters most: what makes a multilingual show feel premium from the very first line?',
      },
      {
        speaker: 'Strategist',
        role: 'Strategist',
        text: 'It starts with contrast. Distinct speakers make the story feel intentional, and the listener instantly knows who is steering the moment.',
      },
      {
        speaker: 'Producer',
        role: 'Producer',
        text: 'That clarity also makes clipping and translation cleaner, because every handoff is already mapped in the master script.',
      },
      {
        speaker: 'Host',
        role: 'Host',
        text: 'So the benefit is retention, not just polish?',
      },
      {
        speaker: 'Strategist',
        role: 'Strategist',
        text: 'Exactly. A sharp three-voice cast keeps the conversation easy to follow and gives the whole episode more momentum.',
      },
      {
        speaker: 'Producer',
        role: 'Producer',
        text: 'And once the direction is locked, we can publish the same episode across markets without rebuilding the performance.',
      },
    ],
  },
  {
    id: 'zh-briefing',
    language: 'Chinese (Simplified)',
    languageCode: 'zh-CN',
    resolvedLanguage: 'zh-CN',
    market: 'Mainland China / Global Mandarin',
    languageCandidates: ['zh-CN', 'zh'],
    useCase: 'Briefing',
    scenario: 'Daily creator briefing',
    direction: 'Measured presenter lead with clean reporter handoffs and a calm analytic finish.',
    summary: 'A three-speaker Mandarin briefing that separates anchor, correspondent, and analyst roles for easier listening.',
    translation: 'An anchor opens the briefing, a correspondent reports on audio trends, and an analyst explains why multi-speaker structure improves clarity.',
    voiceCast: {
      Anchor: 'Orus',
      Correspondent: 'Pulcherrima',
      Analyst: 'Despina',
    },
    lines: [
      {
        speaker: 'Anchor',
        role: 'Anchor',
        text: '大家好，欢迎来到今日简报。今天我们先从音频创作里最值得关注的变化说起。',
      },
      {
        speaker: 'Correspondent',
        role: 'Correspondent',
        text: '我来补充一点：把主持、记者和分析师分开，能让听众更快抓住重点，也更容易保持专注。',
      },
      {
        speaker: 'Analyst',
        role: 'Analyst',
        text: '而且这种结构特别适合多语言发布，因为每一段职责都非常清楚。',
      },
      {
        speaker: 'Anchor',
        role: 'Anchor',
        text: '这样会不会让内容听起来更有层次，也更高级？',
      },
      {
        speaker: 'Correspondent',
        role: 'Correspondent',
        text: '会的。清晰的分工，会让整个节目更像一部节奏分明的纪录片。',
      },
      {
        speaker: 'Analyst',
        role: 'Analyst',
        text: '对制作团队来说也更高效，因为角色和语气在剧本阶段就已经确定好了。',
      },
    ],
  },
  {
    id: 'hi-audiobook',
    language: 'Hindi',
    languageCode: 'hi-IN',
    resolvedLanguage: 'hi-IN',
    market: 'India',
    languageCandidates: ['hi-IN', 'hi'],
    useCase: 'Audiobook',
    scenario: 'Family mystery scene',
    direction: 'Cinematic narration, intimate dialogue, and a low dramatic finish from a third speaker.',
    summary: 'A three-speaker Hindi audiobook scene built for dialogue-heavy fiction and premium serialized storytelling.',
    translation: 'A narrator sets the scene, Asha hears movement in the mansion, and her father pushes the mystery forward.',
    voiceCast: {
      Narrator: 'Fenrir',
      Asha: 'Kore',
      Father: 'Achird',
    },
    lines: [
      {
        speaker: 'Narrator',
        role: 'Narrator',
        text: 'नमस्ते, आज का दृश्य शांत है, लेकिन भीतर छिपा रहस्य हर पल और गहरा होता जा रहा है।',
      },
      {
        speaker: 'Asha',
        role: 'Asha',
        text: 'मां, मुझे ऊपर से कोई हल्की आवाज़ सुनाई दी... क्या कोई वहां है?',
      },
      {
        speaker: 'Father',
        role: 'Father',
        text: 'घबराओ मत, हम धीरे-धीरे देखेंगे। पहले रोशनी संभालो और मेरे पीछे चलो।',
      },
      {
        speaker: 'Narrator',
        role: 'Narrator',
        text: 'उस क्षण हवा और भी ठंडी लगने लगी, जैसे घर ने अपने राज़ को रोककर रखा हो।',
      },
      {
        speaker: 'Asha',
        role: 'Asha',
        text: 'अगर मैं पीछे रहूं तो क्या आप पहले अंदर देखेंगे?',
      },
      {
        speaker: 'Father',
        role: 'Father',
        text: 'बिल्कुल। एक-एक कदम करके चलेंगे, और इस रहस्य को साथ मिलकर सुलझाएंगे.',
      },
    ],
  },
  {
    id: 'es-culture',
    language: 'Spanish',
    languageCode: 'es-ES',
    resolvedLanguage: 'es-ES',
    market: 'Spain / Latin America',
    languageCandidates: ['es-ES', 'es'],
    useCase: 'Podcast',
    scenario: 'Culture recap panel',
    direction: 'Conversational host lead, warm critic analysis, and a crisp production-minded wrap.',
    summary: 'A three-speaker Spanish culture segment designed for podcasts, recap channels, and story-led creator formats.',
    translation: 'A host opens with a festival story, a critic adds social context, and a producer explains why the format localizes well.',
    voiceCast: {
      Host: 'Zephyr',
      Critic: 'Callirrhoe',
      Producer: 'Algenib',
    },
    lines: [
      {
        speaker: 'Host',
        role: 'Host',
        text: 'Bienvenidos a Voces de la Ciudad; hoy abrimos con la historia detrás del festival que volvió a llenar las plazas.',
      },
      {
        speaker: 'Critic',
        role: 'Critic',
        text: 'Lo más interesante es que no fue solo un concierto, sino una mezcla de memoria, barrio y nuevas audiencias.',
      },
      {
        speaker: 'Producer',
        role: 'Producer',
        text: 'Por eso el episodio funciona mejor con tres voces: una guía la escena, otra aporta contexto y la tercera deja el cierre listo para publicación.',
      },
      {
        speaker: 'Host',
        role: 'Host',
        text: '¿También ayuda cuando adaptamos el programa para otros países?',
      },
      {
        speaker: 'Critic',
        role: 'Critic',
        text: 'Muchísimo. Cuando cada intervención es clara, el relato se siente más cercano y más cinematográfico.',
      },
      {
        speaker: 'Producer',
        role: 'Producer',
        text: 'Y para el equipo, la localización sale más rápida porque el reparto ya está definido desde el guion.',
      },
    ],
  },
  {
    id: 'ar-documentary',
    language: 'Arabic',
    languageCode: 'ar-AE',
    resolvedLanguage: 'ar-AE',
    market: 'Middle East / North Africa',
    languageCandidates: ['ar-AE', 'ar'],
    useCase: 'Documentary',
    scenario: 'Historic city feature',
    direction: 'Low cinematic narration with warm expert commentary and a deliberate archival close.',
    summary: 'A three-speaker Arabic documentary passage showing how narration, expert context, and archive detail can stay distinct.',
    translation: 'A narrator introduces the old city, a historian adds context, and an archivist explains why clear cast separation matters for multilingual releases.',
    voiceCast: {
      Narrator: 'Sulafat',
      Historian: 'Umbriel',
      Archivist: 'Rasalgethi',
    },
    lines: [
      {
        speaker: 'Narrator',
        role: 'Narrator',
        text: 'هنا تبدأ الحكاية؛ المدينة القديمة تستيقظ، ويملأ الضوء أزقتها الحجرية بهدوءٍ مهيب.',
      },
      {
        speaker: 'Historian',
        role: 'Historian',
        text: 'ما يهمني هنا هو أن الصوت الأول يجب أن يكون واضحًا جدًا، حتى لا تضيع تفاصيل الرحلة.',
      },
      {
        speaker: 'Archivist',
        role: 'Archivist',
        text: 'ولهذا نعتمد على توزيع الأدوار: الراوي يفتح المشهد، والمؤرخ يضيف السياق، والأرشيفي يثبت التفاصيل.',
      },
      {
        speaker: 'Narrator',
        role: 'Narrator',
        text: 'هل ترى كيف يصبح السرد أقوى عندما نسمع أكثر من طبقة واحدة؟',
      },
      {
        speaker: 'Historian',
        role: 'Historian',
        text: 'بالتأكيد، فالتنظيم الواضح يجعل القصة أقرب إلى فيلم وثائقي سينمائي.',
      },
      {
        speaker: 'Archivist',
        role: 'Archivist',
        text: 'وعندما يكون كل صوت في مكانه، تصبح الترجمة والنشر في أسواق متعددة أسهل بكثير.',
      },
    ],
    rtl: true,
  },
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MOJIBAKE_MARKERS = ['Ã¡', 'Ã©', 'Ã­', 'Ã³', 'Ãº', 'Â¿', 'Ø', 'Ù', 'à¤', 'à¥', 'å¤', 'æˆ', 'çš'];

const readJson = async (targetPath) => {
  const raw = await fs.readFile(targetPath, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
};

const looksMojibake = (value) => {
  const sample = String(value || '');
  return MOJIBAKE_MARKERS.some((marker) => sample.includes(marker));
};

const repairMojibake = (value) => {
  const sample = String(value || '');
  if (!looksMojibake(sample)) return sample;
  try {
    return Buffer.from(sample, 'latin1').toString('utf8');
  } catch {
    return sample;
  }
};

const normalizeEntryText = (entry) => ({
  ...entry,
  lines: Array.isArray(entry.lines)
    ? entry.lines.map((line) => ({
        ...line,
        text: repairMojibake(line.text),
      }))
    : [],
});

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
  const retryAfterMs = Number(String(detail).match(/"retryAfterMs"\s*:\s*(\d+)/)?.[1] || 0);
  return Math.max(2_000, retryAfterMs || attempt * 3_000);
};

const resolveVoiceMap = (entry, voiceCatalog) => {
  const out = new Map();
  for (const [speaker, voiceName] of Object.entries(entry.voiceCast || {})) {
    const voice = voiceCatalog.get(String(voiceName || '').trim());
    if (!voice) {
      throw new Error(`Voice ${voiceName} for ${entry.id} is not present in the PRIME catalog.`);
    }
    out.set(speaker, voice);
  }
  return out;
};

const synthesizeSample = async ({ entry, voicesBySpeaker }) => {
  const primaryVoice = voicesBySpeaker.get(entry.lines[0]?.speaker || '');
  if (!primaryVoice) {
    throw new Error(`No primary voice resolved for ${entry.id}.`);
  }

  const speakerVoices = Array.from(voicesBySpeaker.entries()).map(([speaker, voice]) => ({
    speaker,
    voiceName: voice.voiceId,
  }));
  const lineMap = entry.lines.map((line, lineIndex) => ({
    lineIndex,
    speaker: line.speaker,
    text: line.text,
  }));

  const attempts = [];
  for (const language of entry.languageCandidates) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      const payload = {
        engine: 'PRIME',
        text: entry.lines.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
        language,
        voiceName: primaryVoice.voiceId,
        voice_id: primaryVoice.voiceId,
        voiceId: primaryVoice.voiceId,
        speaker_voices: speakerVoices,
        multi_speaker_mode: 'studio_pair_groups',
        multi_speaker_max_concurrency: 1,
        multi_speaker_retry_once: true,
        multi_speaker_line_map: lineMap,
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
        return { audioBytes, resolvedLanguage: language };
      }

      const detail = await parseErrorDetail(response);
      attempts.push(`${language} attempt ${attempt}/${MAX_RETRIES}: ${detail}`);
      if (attempt < MAX_RETRIES && (response.status === 429 || response.status === 503)) {
        await pause(resolveRetryDelayMs(detail, attempt));
        continue;
      }
      await pause(250);
      break;
    }
  }

  throw new Error(`Runtime synthesis failed for ${entry.language}. ${attempts.join(' | ')}`);
};

const renderManifestJson = (entries) =>
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      engine: 'Prime Voice Engine',
      selectionNote:
        'Featured roundtable, briefing, audiobook, culture, and documentary demos regenerated from the Prime multi-speaker set.',
      featuredIds: ['en-roundtable', 'zh-briefing', 'hi-audiobook', 'es-culture', 'ar-documentary'],
      entries,
    },
    null,
    2,
  );

const main = async () => {
  const voiceCatalog = await parseVoiceCatalog();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const manifestEntries = [];

  console.log(`[vector-multi-demo] runtime=${RUNTIME_SYNTHESIZE_URL}`);

  for (const rawEntry of DEMO_ENTRIES) {
    const entry = normalizeEntryText(rawEntry);
    const voicesBySpeaker = resolveVoiceMap(entry, voiceCatalog);
    const audioFileName = `${entry.id}.wav`;
    const audioRelativePath = `/audio/vector-multi-demo/${audioFileName}`;
    const targetPath = path.join(OUTPUT_DIR, audioFileName);
    let resolvedLanguage = entry.languageCandidates[0];
    try {
      const synthesis = await synthesizeSample({ entry, voicesBySpeaker });
      await fs.writeFile(targetPath, synthesis.audioBytes);
      resolvedLanguage = synthesis.resolvedLanguage;
    } catch (error) {
      try {
        await fs.access(targetPath);
        console.warn(`[vector-multi-demo] ${entry.language} synthesis failed, keeping existing asset at ${audioRelativePath}`);
      } catch {
        throw error;
      }
    }

    const castRows = entry.lines.map((line, lineIndex) => {
      const voice = voicesBySpeaker.get(line.speaker);
      if (!voice) {
        throw new Error(`Voice for speaker ${line.speaker} is missing in ${entry.id}.`);
      }
      return {
        lineIndex,
        speaker: line.speaker,
        role: line.role,
        displayName: voice.displayName,
        voiceId: voice.voiceId,
        voiceGender: voice.gender,
        text: line.text,
      };
    });

    const cast = Array.from(
      new Map(
        castRows.map((line) => [
          line.speaker,
          {
            speaker: line.speaker,
            role: line.role,
            displayName: line.displayName,
            voiceId: line.voiceId,
            voiceGender: line.voiceGender,
            lineCount: castRows.filter((entry) => entry.speaker === line.speaker).length,
          },
        ]),
      ).values(),
    );

    const castSummary = Array.from(
      new Map(castRows.map((line) => [line.speaker, `${line.role}: ${line.displayName}`])).values(),
    ).join(' + ');

    manifestEntries.push({
      id: entry.id,
      language: entry.language,
      languageCode: entry.languageCandidates[0],
      resolvedLanguage,
      market: entry.market,
      useCase: entry.useCase,
      scenario: entry.scenario,
      direction: entry.direction,
      summary: entry.summary,
      translation: entry.translation,
      castSummary,
      cast,
      audioSrc: audioRelativePath,
      lines: castRows,
      ...(entry.rtl ? { rtl: true } : {}),
    });

    console.log(
      `[vector-multi-demo] ${entry.language} -> ${audioRelativePath} | language=${resolvedLanguage} | cast=${castSummary}`,
    );

    await pause(1500);
  }

  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, `${renderManifestJson(manifestEntries)}\n`, 'utf8');
  console.log(`[vector-multi-demo] manifest written -> ${path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/')}`);
};

main().catch((error) => {
  console.error(`[vector-multi-demo] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
