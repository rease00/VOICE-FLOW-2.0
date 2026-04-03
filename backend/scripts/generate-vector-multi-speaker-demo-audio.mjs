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
    id: 'en-weekend-plan',
    language: 'English',
    market: 'United States / Global English',
    languageCandidates: ['en-US', 'en'],
    useCase: 'Movie Night',
    scenario: 'The Weekend Plan',
    direction: 'Casual, energetic, and opinionated pacing with playful handoffs.',
    summary: 'Three friends debate weekend movie plans with quick, expressive turns.',
    translation: 'A friend pitches a sci-fi blockbuster, another pushes for an indie drama, and the third lands on doing both.',
    voiceCast: {
      Alex: 'Alnilam',
      Jordan: 'Leda',
      Casey: 'Laomedeia',
    },
    lines: [
      {
        speaker: 'Alex',
        role: 'Alex',
        text: '<tone="excited">Hey guys! Have you seen the trailer for the new sci-fi epic? It looks absolutely stunning!</tone>',
      },
      {
        speaker: 'Jordan',
        role: 'Jordan',
        text: '<tone="skeptical">I do not know, Alex. <pause="300ms"/> The last one was all special effects and no plot. I would rather catch that new indie drama.</tone>',
      },
      {
        speaker: 'Casey',
        role: 'Casey',
        text: '<tone="diplomatic"><mood="calm">Why not both? We can do the blockbuster tonight and the drama on Sunday.</mood> <tone="playful">Plus, I am really just here for the popcorn!</tone></tone>',
      },
    ],
  },
  {
    id: 'hi-family-dinner',
    language: 'Hindi',
    languageCode: 'hi-IN',
    resolvedLanguage: 'hi-IN',
    market: 'India',
    languageCandidates: ['hi-IN', 'hi'],
    useCase: 'Family Scene',
    scenario: 'Family Dinner',
    direction: 'Warm, authentic, and relatable pacing with natural family dynamics.',
    summary: 'A mother calls everyone to dinner while the son delays and the father teases him.',
    translation: 'A warm family moment where urgency, distraction, and gentle authority blend naturally.',
    voiceCast: {
      Mother: 'Kore',
      Rohan: 'Achird',
      Father: 'Fenrir',
    },
    lines: [
      {
        speaker: 'Mother',
        role: 'Mother',
        text: '<tone="shouting_softly">रोहन! खाने की मेज पर आओ, खाना ठंडा हो रहा है!</tone>',
      },
      {
        speaker: 'Rohan',
        role: 'Rohan',
        text: '<tone="distracted"><mood="busy">बस दो मिनट मम्मी! मैं अपना गेम बस खत्म ही करने वाला हूँ!</mood></tone>',
      },
      {
        speaker: 'Father',
        role: 'Father',
        text: '<tone="authoritative"><mood="teasing">बेटा, तुम्हारी माँ की डाँट से अच्छा है कि तुम गेम अभी बंद कर दो। <pause="400ms"/> और वैसे भी, आज खुशबू बहुत अच्छी आ रही है!</mood></tone>',
      },
    ],
  },
  {
    id: 'es-boutique-shop',
    language: 'Spanish',
    languageCode: 'es-ES',
    resolvedLanguage: 'es-ES',
    market: 'Spain / Latin America',
    languageCandidates: ['es-ES', 'es'],
    useCase: 'Retail',
    scenario: 'The Boutique Shop',
    direction: 'Polite and vibrant delivery with helpful, expressive customer-service pacing.',
    summary: 'A tourist asks for a smaller jacket and the shopkeeper finds the final piece in stock.',
    translation: 'A customer asks for another size in blue and the shopkeeper returns with the last available one.',
    voiceCast: {
      Customer: 'Callirrhoe',
      Shopkeeper: 'Zephyr',
    },
    lines: [
      {
        speaker: 'Customer',
        role: 'Customer',
        text: '<tone="curious">¡Perdón! Esta chaqueta es hermosa. ¿La tienen en una talla más pequeña, tal vez en azul?</tone>',
      },
      {
        speaker: 'Shopkeeper',
        role: 'Shopkeeper',
        text: '<tone="helpful"><mood="joyful">¡Claro que sí! Déjame revisar en el almacén. <pause="500ms"/> Estás de suerte, <tone="excited">¡es la última que nos queda y te verás increíble!</tone></mood></tone>',
      },
    ],
  },
  {
    id: 'ja-office-deadline',
    language: 'Japanese',
    languageCode: 'ja-JP',
    resolvedLanguage: 'ja-JP',
    market: 'Japan',
    languageCandidates: ['ja-JP', 'ja'],
    useCase: 'Office',
    scenario: 'The Office Deadline',
    direction: 'Professional but exhausted pacing with clear support between coworkers.',
    summary: 'Two colleagues close a late-night presentation and hand off final review.',
    translation: 'One teammate finishes the slides and the other reassures them while taking final checks.',
    voiceCast: {
      Tanaka: 'Achernar',
      Sato: 'Despina',
    },
    lines: [
      {
        speaker: 'Tanaka',
        role: 'Tanaka',
        text: '<tone="tired">佐藤さん、プレゼンの資料はやっと終わりました。チェックをお願いできますか？</tone>',
      },
      {
        speaker: 'Sato',
        role: 'Sato',
        text: '<tone="encouraging"><mood="focused">お疲れ様です、田中さん！ <pause="400ms"/> 本当に助かりました。 <tone="determined">あとは私が最終確認をしておきますから、今日はもう帰って休んでください。</tone></mood></tone>',
      },
    ],
  },
  {
    id: 'fr-city-tour',
    language: 'French',
    languageCode: 'fr-FR',
    resolvedLanguage: 'fr-FR',
    market: 'France / Francophone Europe',
    languageCandidates: ['fr-FR', 'fr'],
    useCase: 'Tour',
    scenario: 'The City Tour',
    direction: 'Sophisticated and wonder-filled pacing with a warm romantic close.',
    summary: 'A guide introduces the Eiffel Tower while a couple responds with awe and gratitude.',
    translation: 'A guide presents historical context and two tourists react with amazement as the tower begins to sparkle.',
    voiceCast: {
      Guide: 'Sadaltager',
      Tourist1: 'Schedar',
      Tourist2: 'Iapetus',
    },
    lines: [
      {
        speaker: 'Guide',
        role: 'Guide',
        text: "<tone=\"informative\">Et voilà! Devant vous, la Dame de Fer. Elle a été construite pour l'Exposition Universelle de 1889.</tone>",
      },
      {
        speaker: 'Tourist1',
        role: 'Tourist1',
        text: "<tone=\"amazed\"><mood=\"breathless\">C'est encore plus grand que ce que j'imaginais... C'est magnifique, n'est-ce pas ?</mood></tone>",
      },
      {
        speaker: 'Tourist2',
        role: 'Tourist2',
        text: '<tone="romantic"><mood="soft">Absolument. <pause="500ms"/> Merci de nous avoir amenés ici juste au moment où elle commence à briller.</mood></tone>',
      },
    ],
  },
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MOJIBAKE_MARKERS = ['Ã¡', 'Ã©', 'Ã­', 'Ã³', 'Ãº', 'Â¿', 'Ø', 'Ù', 'à¤', 'à¥', 'å¤', 'æˆ', 'çš', 'Ãƒ', 'Ã‚'];

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
        text: entry.lines.map((line) => line.text).join('\n'),
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
        'Featured weekend plan, family dinner, boutique, office deadline, and city tour demos regenerated from the Prime multi-speaker set.',
      featuredIds: ['en-weekend-plan', 'hi-family-dinner', 'es-boutique-shop', 'ja-office-deadline', 'fr-city-tour'],
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

