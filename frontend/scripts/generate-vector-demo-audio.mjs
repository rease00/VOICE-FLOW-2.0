#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const runtimeBaseUrl = String(process.env.VF_VECTOR_RUNTIME_URL || 'http://127.0.0.1:7810').replace(/\/+$/, '');
const runtimeSynthesizeUrl = `${runtimeBaseUrl}/synthesize`;
const voiceName = String(process.env.VF_VECTOR_DEMO_VOICE || 'Fenrir').trim() || 'Fenrir';
const outputDir = path.resolve(process.cwd(), 'frontend/public/audio/vector-demo');

const vectorSamples = [
  {
    slug: 'en-us',
    language: 'English (US)',
    country: 'United States',
    code: 'en-US',
    text: 'Hi! Good morning. Could I get a coffee and a bagel, please?',
  },
  {
    slug: 'hi',
    language: 'Hindi',
    country: 'India',
    code: 'hi',
    text: 'à¤¨à¤®à¤¸à¥à¤¤à¥‡! à¤†à¤ª à¤•à¥ˆà¤¸à¥‡ à¤¹à¥ˆà¤‚? à¤®à¥à¤à¥‡ à¤à¤• à¤šà¤¾à¤¯ à¤”à¤° à¤¸à¤®à¥‹à¤¸à¤¾ à¤šà¤¾à¤¹à¤¿à¤à¥¤',
  },
  {
    slug: 'bn',
    language: 'Bengali',
    country: 'Bangladesh / India',
    code: 'bn',
    text: 'à¦¹à§à¦¯à¦¾à¦²à§‹! à¦•à§‡à¦®à¦¨ à¦†à¦›à§‡à¦¨? à¦†à¦®à¦¿ à¦†à¦œ à¦¬à¦¾à¦œà¦¾à¦°à§‡ à¦¯à¦¾à¦šà§à¦›à¦¿à¥¤',
  },
  {
    slug: 'ta',
    language: 'Tamil',
    country: 'India / Sri Lanka',
    code: 'ta',
    text: 'à®µà®£à®•à¯à®•à®®à¯! à®šà®¾à®ªà¯à®ªà®¾à®Ÿà¯ à®°à¯†à®Ÿà®¿à®¯à®¾? à®¨à®¾à®©à¯ à®•à¯Šà®žà¯à®šà®®à¯ à®¤à®¾à®®à®¤à®®à®¾à®• à®µà®°à¯à®µà¯‡à®©à¯.',
  },
  {
    slug: 'es',
    language: 'Spanish',
    country: 'Spain',
    code: 'es',
    text: 'Hola, Â¿quÃ© tal? Quiero reservar una mesa para dos personas.',
  },
  {
    slug: 'fr',
    language: 'French',
    country: 'France',
    code: 'fr',
    text: 'Bonjour, comment Ã§a va? Je voudrais un billet pour demain matin.',
  },
  {
    slug: 'de',
    language: 'German',
    country: 'Germany',
    code: 'de',
    text: 'Guten Tag! Wo ist die nÃ¤chste U-Bahn-Station?',
  },
  {
    slug: 'it',
    language: 'Italian',
    country: 'Italy',
    code: 'it',
    text: 'Ciao! Possiamo incontrarci in piazza alle sei?',
  },
  {
    slug: 'pt-br',
    language: 'Portuguese (Brazil)',
    country: 'Brazil',
    code: 'pt-BR',
    text: 'Oi! Tudo bem? Vamos comeÃ§ar a reuniÃ£o em cinco minutos.',
  },
  {
    slug: 'ar',
    language: 'Arabic',
    country: 'United Arab Emirates',
    code: 'ar',
    text: 'Ù…Ø±Ø­Ø¨Ù‹Ø§! ÙƒÙŠÙ Ø­Ø§Ù„ÙƒØŸ Ø£Ø±ÙŠØ¯ Ø³ÙŠØ§Ø±Ø© Ø£Ø¬Ø±Ø© Ø¥Ù„Ù‰ ÙˆØ³Ø· Ø§Ù„Ù…Ø¯ÙŠÙ†Ø©.',
  },
  {
    slug: 'ru',
    language: 'Russian',
    country: 'Russia',
    code: 'ru',
    text: 'ÐŸÑ€Ð¸Ð²ÐµÑ‚! ÐšÐ°Ðº Ð´ÐµÐ»Ð°? Ð”Ð°Ð²Ð°Ð¹ Ð²ÑÑ‚Ñ€ÐµÑ‚Ð¸Ð¼ÑÑ Ð¿Ð¾ÑÐ»Ðµ Ñ€Ð°Ð±Ð¾Ñ‚Ñ‹.',
  },
  {
    slug: 'tr',
    language: 'Turkish',
    country: 'Turkey',
    code: 'tr',
    text: 'Merhaba! NasÄ±lsÄ±n? BugÃ¼n hava Ã§ok gÃ¼zel.',
  },
  {
    slug: 'ja',
    language: 'Japanese',
    country: 'Japan',
    code: 'ja',
    text: 'ã“ã‚“ã«ã¡ã¯ã€‚é§…ã¾ã§ã®é“ã‚’æ•™ãˆã¦ã„ãŸã ã‘ã¾ã™ã‹ã€‚',
  },
  {
    slug: 'ko',
    language: 'Korean',
    country: 'South Korea',
    code: 'ko',
    text: 'ì•ˆë…•í•˜ì„¸ìš”! ì˜¤ëŠ˜ ì €ë…ì— ê°™ì´ ì‹ì‚¬í• ê¹Œìš”?',
  },
  {
    slug: 'zh-cn',
    language: 'Chinese (Simplified)',
    country: 'China',
    code: 'zh',
    text: 'ä½ å¥½ï¼è¯·é—®æœ€è¿‘çš„åœ°é“ç«™åœ¨å“ªé‡Œï¼Ÿ',
  },
];

const parseErrorDetail = async (response) => {
  const body = await response.text();
  if (!body) return `HTTP ${response.status}`;
  try {
    const json = JSON.parse(body);
    return json?.detail || json?.error || JSON.stringify(json);
  } catch {
    return body.slice(0, 300);
  }
};

const synthesizeSample = async (sample) => {
  const payloadBase = {
    engine: 'VECTOR',
    text: sample.text,
    voiceName,
    voice_id: voiceName,
    speed: 1,
  };
  const payloads = sample.code
    ? [{ ...payloadBase, language: sample.code }, payloadBase]
    : [payloadBase];

  for (const payload of payloads) {
    const response = await fetch(runtimeSynthesizeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      console.warn(`[vector-demo] ${sample.slug} failed (${response.status}) payload=${JSON.stringify(payload)} detail=${detail}`);
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { payload, bytes };
  }
  throw new Error(`VECTOR runtime synthesis failed for ${sample.slug}`);
};

const run = async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const manifest = [];
  console.log(`[vector-demo] runtime=${runtimeSynthesizeUrl} voice=${voiceName}`);

  for (const sample of vectorSamples) {
    const outFile = path.join(outputDir, `${sample.slug}.wav`);
    console.log(`[vector-demo] generating ${sample.language} (${sample.code}) -> ${outFile}`);
    const result = await synthesizeSample(sample);
    await fs.writeFile(outFile, Buffer.from(result.bytes));
    manifest.push({
      slug: sample.slug,
      language: sample.language,
      country: sample.country,
      code: sample.code,
      file: `/audio/vector-demo/${sample.slug}.wav`,
      generatedWith: {
        engine: 'VECTOR',
        voiceName,
        payloadLanguage: result.payload.language || null,
      },
    });
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runtimeSynthesizeUrl,
        engine: 'VECTOR',
        voiceName,
        samples: manifest,
      },
      null,
      2,
    ),
  );
  console.log(`[vector-demo] complete. manifest: ${manifestPath}`);
};

run().catch((error) => {
  console.error(`[vector-demo] failed: ${error?.stack || error}`);
  process.exitCode = 1;
});

