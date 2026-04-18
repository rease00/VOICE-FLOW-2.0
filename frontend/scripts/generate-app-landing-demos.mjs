#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const appBaseUrl = String(process.env.VF_STUDIO_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const streamUrl = `${appBaseUrl}/api/v1/studio/tts/stream`;
const devUid = String(process.env.VF_DEMO_DEV_UID || 'demo-generator').trim() || 'demo-generator';
const devEmail = String(process.env.VF_DEMO_DEV_EMAIL || 'demo@local.test').trim() || 'demo@local.test';
const defaultLanguage = String(process.env.VF_DEMO_LANGUAGE || 'en-US').trim() || 'en-US';
const defaultEngine = String(process.env.VF_DEMO_ENGINE || 'VECTOR').trim().toUpperCase() || 'VECTOR';
const maxRetryAttempts = Number.parseInt(String(process.env.VF_DEMO_MAX_RETRIES || '8'), 10) || 8;
const retryBaseMs = Number.parseInt(String(process.env.VF_DEMO_RETRY_BASE_MS || '12000'), 10) || 12000;
const retryMaxMs = Number.parseInt(String(process.env.VF_DEMO_RETRY_MAX_MS || '90000'), 10) || 90000;

const parsedReaderMinDuration = Number.parseFloat(String(process.env.VF_READER_DEMO_MIN_DURATION_SEC || '25'));
const parsedReaderMaxDuration = Number.parseFloat(String(process.env.VF_READER_DEMO_MAX_DURATION_SEC || '35'));
const readerDemoMinDurationSec = Number.isFinite(parsedReaderMinDuration) ? parsedReaderMinDuration : 25;
const readerDemoMaxDurationSec = Number.isFinite(parsedReaderMaxDuration) ? parsedReaderMaxDuration : 35;

const parsedReaderChapterMinDuration = Number.parseFloat(String(process.env.VF_READER_CHAPTER_MIN_DURATION_SEC || '20'));
const parsedReaderChapterMaxDuration = Number.parseFloat(String(process.env.VF_READER_CHAPTER_MAX_DURATION_SEC || '120'));
const readerChapterMinDurationSec = Number.isFinite(parsedReaderChapterMinDuration) ? parsedReaderChapterMinDuration : 20;
const readerChapterMaxDurationSec = Number.isFinite(parsedReaderChapterMaxDuration) ? parsedReaderChapterMaxDuration : 120;

const projectRoot = process.cwd();
const singleDir = path.join(projectRoot, 'frontend', 'public', 'audio', 'vector-demo');
const multiDir = path.join(projectRoot, 'frontend', 'public', 'audio', 'vector-multi-demo');
const readerDir = path.join(projectRoot, 'frontend', 'public', 'audio', 'reader-demo');

const speakerVoices = {
  Aryan: 'Puck',
  Neha: 'Kore',
  Raj: 'Charon',
  Priya: 'Zephyr',
};

const singleSpeakerDemos = [
  {
    slug: 'morning-brief-en',
    title: 'Morning Brief',
    summary: 'A compact morning-ready status update for single-voice checks.',
    language: 'English',
    country: 'Global',
    payloadLanguage: 'en-US',
    voice: speakerVoices.Aryan,
    text: 'Quick morning brief. You have one product sync at ten, one review at two, and a final wrap at five. Keep delivery clear, energetic, and focused.',
  },
  {
    slug: 'support-update-hi',
    title: 'Support Update',
    summary: 'A calm reassurance read for support-first voice review.',
    language: 'Hindi',
    country: 'Global',
    payloadLanguage: 'hi-IN',
    voice: speakerVoices.Neha,
    text: 'Support update. We received your issue report and verified the behavior. A fix is scheduled in the next release window and we will keep you posted every step of the way.',
  },
  {
    slug: 'delivery-alert-es',
    title: 'Delivery Alert',
    summary: 'A bright delivery confirmation for quick voice audition.',
    language: 'Spanish',
    country: 'Global',
    payloadLanguage: 'es-ES',
    voice: speakerVoices.Raj,
    text: 'Delivery alert. Tu pedido ya esta despachado y llega hoy entre las tres y las cinco de la tarde. Mantente cerca del telefono para la entrega.',
  },
  {
    slug: 'podcast-opening-en',
    title: 'Podcast Opening',
    summary: 'An energetic intro lane for presentation and pacing checks.',
    language: 'English',
    country: 'Global',
    payloadLanguage: 'en-US',
    voice: speakerVoices.Priya,
    text: 'Launch reminder. Final QA starts in twenty minutes. Confirm assets, lock the narration pass, and keep your approval notes concise for the team.',
  },
];

const multiSpeakerDemos = [
  {
    id: 'en-smart-home-chat',
    title: 'Morning Smart Home Chat',
    language: 'English',
    market: 'Global English',
    payloadLanguage: 'en-US',
    useCase: 'Daily assistant',
    scenario: 'Smart home morning chat',
    direction: 'Cheerful, playful handoffs with a natural wake-up rhythm.',
    summary: 'A light two-voice morning exchange with weather and reminder cues.',
    speakers: ['Aryan', 'Neha'],
    script: [
      'Aryan: [cheerfully] Hey Neha! Good morning — quick heads up before you start your day.',
      'Neha: [sleepily] Mm... yeah go ahead, what\'s up?',
      'Aryan: [playfully] So, it\'s 24 degrees outside, pretty sunny — great day to not stay indoors.',
      'Neha: [laughs] You literally say that every day.',
      'Aryan: [warmly] Because every day you stay indoors! Anyway — your 10 AM standup is still on.',
      '<break time="300ms"/>',
      'Neha: [sighs] Ugh, fine. Okay. Coffee first though.',
      'Aryan: [bright] Obviously. Go go go!',
    ].join('\n'),
    lines: [
      { speaker: 'Aryan', text: '[cheerfully] Hey Neha! Good morning — quick heads up before you start your day.' },
      { speaker: 'Neha', text: '[sleepily] Mm... yeah go ahead, what\'s up?' },
      { speaker: 'Aryan', text: '[playfully] So, it\'s 24 degrees outside, pretty sunny — great day to not stay indoors.' },
      { speaker: 'Neha', text: '[laughs] You literally say that every day.' },
      { speaker: 'Aryan', text: '[warmly] Because every day you stay indoors! Anyway — your 10 AM standup is still on.' },
      { speaker: 'Neha', text: '[sighs] Ugh, fine. Okay. Coffee first though.' },
      { speaker: 'Aryan', text: '[bright] Obviously. Go go go!' },
    ],
  },
  {
    id: 'hi-support-call',
    title: 'Customer Support Call',
    language: 'Hindi',
    market: 'India Hindi',
    payloadLanguage: 'hi-IN',
    useCase: 'Support escalation',
    scenario: 'Customer support call',
    direction: 'Empathetic escalation with reassurance and clear resolution cues.',
    summary: 'A Hindi support conversation with escalation and supervisor intervention.',
    speakers: ['Raj', 'Priya', 'Aryan'],
    script: [
      'Raj: [frustrated] Yaar, mera order abhi tak nahi aaya — teen din ho gaye hain!',
      'Priya: [calmly] Arrey, main samajh sakti hoon aapki baat. Ek second, main check karti hoon.',
      '<break time="500ms"/>',
      'Priya: [reassuringly] Haan, aapka order kal dispatch hua hai — kal shaam tak aa jayega pakka.',
      'Raj: [doubtfully] Pakka? Pehle bhi yahi bola tha na...',
      'Priya: [gently] Main guarantee de rahi hoon is baar. Aur agar nahi aaya toh—',
      'Aryan: [professionally] Main supervisor Aryan bol raha hoon — hum personally ensure karenge delivery. Sorry for the wait!',
      'Raj: [relieved] Okay okay, theek hai. Thanks yaar.',
    ].join('\n'),
    lines: [
      { speaker: 'Raj', text: '[frustrated] Yaar, mera order abhi tak nahi aaya — teen din ho gaye hain!' },
      { speaker: 'Priya', text: '[calmly] Arrey, main samajh sakti hoon aapki baat. Ek second, main check karti hoon.' },
      { speaker: 'Priya', text: '[reassuringly] Haan, aapka order kal dispatch hua hai — kal shaam tak aa jayega pakka.' },
      { speaker: 'Raj', text: '[doubtfully] Pakka? Pehle bhi yahi bola tha na...' },
      { speaker: 'Priya', text: '[gently] Main guarantee de rahi hoon is baar. Aur agar nahi aaya toh—' },
      { speaker: 'Aryan', text: '[professionally] Main supervisor Aryan bol raha hoon — hum personally ensure karenge delivery. Sorry for the wait!' },
      { speaker: 'Raj', text: '[relieved] Okay okay, theek hai. Thanks yaar.' },
    ],
  },
  {
    id: 'es-delivery-chat',
    title: 'Delivery Update Chat',
    language: 'Spanish',
    market: 'Spain Spanish',
    payloadLanguage: 'es-ES',
    useCase: 'Delivery update',
    scenario: 'Delivery handoff chat',
    direction: 'Upbeat status exchange with playful but clear logistics pacing.',
    summary: 'A Spanish two-voice delivery handoff with timing confirmation.',
    speakers: ['Neha', 'Raj'],
    script: [
      'Neha: [upbeat] ¡Ey! Tu paquete está casi en tu puerta.',
      'Raj: [surprised] ¿En serio? ¿Ya?',
      'Neha: [cheerfully] ¡Sí! El repartidor llega entre las 3 y las 5. ¡Hoy es el día!',
      'Raj: [playfully] Buf, por fin — llevaba esperándolo como una semana.',
      'Neha: [warmly] Lo sabemos, perdona la espera. ¿Estarás en casa a esa hora?',
      'Raj: [casually] Sí sí, no me muevo. Gracias eh.',
      'Neha: [bright] ¡Perfecto! ¡Que lo disfrutes!',
    ].join('\n'),
    lines: [
      { speaker: 'Neha', text: '[upbeat] ¡Ey! Tu paquete está casi en tu puerta.' },
      { speaker: 'Raj', text: '[surprised] ¿En serio? ¿Ya?' },
      { speaker: 'Neha', text: '[cheerfully] ¡Sí! El repartidor llega entre las 3 y las 5. ¡Hoy es el día!' },
      { speaker: 'Raj', text: '[playfully] Buf, por fin — llevaba esperándolo como una semana.' },
      { speaker: 'Neha', text: '[warmly] Lo sabemos, perdona la espera. ¿Estarás en casa a esa hora?' },
      { speaker: 'Raj', text: '[casually] Sí sí, no me muevo. Gracias eh.' },
      { speaker: 'Neha', text: '[bright] ¡Perfecto! ¡Que lo disfrutes!' },
    ],
  },
  {
    id: 'en-podcast-style',
    title: 'Podcast Style Roundtable',
    language: 'English',
    market: 'Global English',
    payloadLanguage: 'en-US',
    useCase: 'Podcast conversation',
    scenario: 'Podcast style roundtable',
    direction: 'Conversational panel cadence with dynamic but readable handoffs.',
    summary: 'A four-voice English roundtable discussing TTS quality and expression.',
    speakers: ['Aryan', 'Neha', 'Raj', 'Priya'],
    script: [
      'Aryan: [enthusiastically] Alright folks, welcome back! Today we\'re talking about AI voices — and it\'s gonna get nerdy.',
      'Neha: [laughs] I mean, when does it NOT get nerdy with us?',
      'Aryan: [playfully] Fair point. So Raj, you\'ve been testing Gemini TTS — first impressions?',
      'Raj: [casually] Honestly? Way better than I expected. Like the emotions actually land, you know?',
      '<break time="400ms"/>',
      'Priya: [thoughtfully] That\'s the thing — most TTS engines fake emotion. Gemini actually reads context.',
      'Neha: [curious] So like, it figures out the vibe from the sentence itself?',
      'Priya: [warmly] Exactly. You write "ugh, not again" — it doesn\'t need a tag. It just... gets it.',
      'Aryan: [impressed] That\'s wild. Okay we are definitely doing a full demo next episode.',
      'Neha: [bright] Subscribe people — you don\'t wanna miss that one!',
    ].join('\n'),
    lines: [
      { speaker: 'Aryan', text: '[enthusiastically] Alright folks, welcome back! Today we\'re talking about AI voices — and it\'s gonna get nerdy.' },
      { speaker: 'Neha', text: '[laughs] I mean, when does it NOT get nerdy with us?' },
      { speaker: 'Aryan', text: '[playfully] Fair point. So Raj, you\'ve been testing Gemini TTS — first impressions?' },
      { speaker: 'Raj', text: '[casually] Honestly? Way better than I expected. Like the emotions actually land, you know?' },
      { speaker: 'Priya', text: '[thoughtfully] That\'s the thing — most TTS engines fake emotion. Gemini actually reads context.' },
      { speaker: 'Neha', text: '[curious] So like, it figures out the vibe from the sentence itself?' },
      { speaker: 'Priya', text: '[warmly] Exactly. You write "ugh, not again" — it doesn\'t need a tag. It just... gets it.' },
      { speaker: 'Aryan', text: '[impressed] That\'s wild. Okay we are definitely doing a full demo next episode.' },
      { speaker: 'Neha', text: '[bright] Subscribe people — you don\'t wanna miss that one!' },
    ],
  },
];

const readerDemoSample = {
  id: 'reader-review-en-30s',
  title: 'Reader Review Sample',
  summary: 'A 30-second approval-style reader pass for final listening checks.',
  language: 'English',
  locale: 'en-US',
  voice: speakerVoices.Priya,
  cue: 'Reader sample · final pass',
  posterSrc: '/images/reader-demo-poster.svg',
  text: 'Welcome to the final listening pass. This short reader sample is designed to sound like an approval run, not a dramatic trailer. You will hear steady pacing, clear consonants, and intentional pauses between sections. <break time="700ms"/> Use this moment to confirm names, sentence rhythm, and chapter tone. <break time="700ms"/> If the delivery matches your script, move into the app reader, continue from scene three, and lock the episode for publish.',
};

const virtualReaderBook = {
  id: 'virtual-book-lighthouse-ledger',
  title: 'The Lighthouse Ledger',
  author: 'V FLOW AI Demo Press',
  language: 'English',
  locale: 'en-US',
  coverSrc: '/images/virtual-reader-book-cover.svg',
  description: 'A two-chapter mystery preview for Reader demos with chapter-level playback checks.',
  chapters: [
    {
      id: 'chapter-01-fog-over-meridian-bay',
      order: 1,
      title: 'Chapter 01 - Fog Over Meridian Bay',
      summary: 'A harbor town wakes to a missing ledger and a warning bell before sunrise.',
      cue: 'Virtual book · chapter 1',
      voice: speakerVoices.Priya,
      text: 'Chapter one. Meridian Bay woke under thick fog, and the harbor bell rang before sunrise. Lina found the lighthouse door open, the night lantern still warm, and the captain\'s ledger gone from its iron shelf. <break time="500ms"/> On the last page, one line remained in blue ink: if the tide turns twice before noon, do not trust the second signal. <break time="500ms"/> She folded the warning into her coat, crossed the wet stone quay, and promised herself she would find whoever rewrote the harbor clock.',
    },
    {
      id: 'chapter-02-the-second-signal',
      order: 2,
      title: 'Chapter 02 - The Second Signal',
      summary: 'Lina follows the coded bell pattern and uncovers a staged rescue call.',
      cue: 'Virtual book · chapter 2',
      voice: speakerVoices.Priya,
      text: 'Chapter two. By midmorning, the tide had turned once, and the town watched the channel in silence. Lina climbed the signal tower and counted the bell pattern: three short, one long, then three short again. <break time="500ms"/> It matched an old distress code, but the rescue flare never rose. Instead, a tugboat drifted empty near the reef with fresh paint over its name. <break time="500ms"/> Lina marked the hidden letters beneath the paint, sent a trusted runner to the archive, and prepared for the second signal before the storm reached the bay.',
    },
  ],
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const buildWavHeader = (dataLength) => {
  const header = Buffer.alloc(44);
  const blockAlign = 1 * (16 / 8);
  const byteRate = 24000 * blockAlign;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
};

const stripWavHeader = (buf) => {
  for (let i = 0; i < Math.min(buf.length - 8, 200); i += 1) {
    if (
      buf[i] === 0x64
      && buf[i + 1] === 0x61
      && buf[i + 2] === 0x74
      && buf[i + 3] === 0x61
    ) {
      return buf.subarray(i + 8);
    }
  }
  return buf.subarray(44);
};

const concatenateWavBuffers = (buffers) => {
  const pcmChunks = buffers.map(stripWavHeader);
  const totalPcmLength = pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const header = buildWavHeader(totalPcmLength);
  return Buffer.concat([header, ...pcmChunks]);
};

const isWavBuffer = (buf) => (
  Buffer.isBuffer(buf)
  && buf.length >= 12
  && buf.toString('ascii', 0, 4) === 'RIFF'
  && buf.toString('ascii', 8, 12) === 'WAVE'
);

const parseSseDataPayload = (rawEvent) => {
  if (!rawEvent) return null;
  const dataLines = [];
  for (const line of rawEvent.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith(':')) continue;
    if (!trimmed.startsWith('data:')) continue;
    dataLines.push(trimmed.slice(5).replace(/^\s/, ''));
  }
  if (dataLines.length <= 0) return null;
  return dataLines.join('\n');
};

const readStreamedAudio = async (response, label) => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`Stream response did not expose a readable body for ${label}.`);
  }

  const decoder = new TextDecoder();
  const audioChunks = [];
  let currentContentType = 'audio/wav';
  let sawDone = false;
  let buffer = '';

  const processEvent = (rawEvent) => {
    const payloadText = parseSseDataPayload(rawEvent);
    if (!payloadText) return;

    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new Error(`Invalid SSE JSON payload received for ${label}.`);
    }

    const eventType = String(payload?.type || '').trim().toLowerCase();
    if (eventType === 'error') {
      throw new Error(String(payload?.message || 'Stream returned an error event.'));
    }

    if (eventType === 'chunk') {
      const audioBase64 = String(payload?.audioBase64 || '').trim();
      if (!audioBase64) return;
      const chunkBuffer = Buffer.from(audioBase64, 'base64');
      if (chunkBuffer.length <= 0) return;
      audioChunks.push(chunkBuffer);
      const contentType = String(payload?.contentType || '').trim();
      if (contentType) {
        currentContentType = contentType;
      }
      return;
    }

    if (eventType === 'done') {
      sawDone = true;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    while (true) {
      const separator = buffer.indexOf('\n\n');
      if (separator < 0) break;
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      processEvent(rawEvent);
    }
  }

  buffer += decoder.decode().replace(/\r\n/g, '\n');
  const trailing = buffer.trim();
  if (trailing) {
    processEvent(trailing);
  }

  if (audioChunks.length <= 0) {
    throw new Error(`Stream finished without audio chunks for ${label}.`);
  }

  if (!sawDone) {
    console.warn(`[app-demos] stream closed without explicit done event for ${label}; using collected audio.`);
  }

  if (audioChunks.length === 1) {
    return audioChunks[0];
  }

  const shouldConcatAsWav = currentContentType.toLowerCase().includes('wav') && audioChunks.every(isWavBuffer);
  return shouldConcatAsWav ? concatenateWavBuffers(audioChunks) : Buffer.concat(audioChunks);
};

const writeTextFileWithRetry = async (filePath, text, attempts = 6, pauseMs = 220) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.writeFile(filePath, text);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        break;
      }
      await wait(pauseMs * attempt);
    }
  }
  throw lastError;
};

const parseWavDurationSeconds = (bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44) return null;
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (bytes.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ' && chunkStart + 16 <= bytes.length) {
      byteRate = bytes.readUInt32LE(chunkStart + 8);
    }

    if (chunkId === 'data') {
      const availableData = Math.max(bytes.length - chunkStart, 0);
      dataSize = Math.min(chunkSize, availableData);
    }

    const paddedChunkSize = chunkSize + (chunkSize % 2);
    offset = chunkStart + paddedChunkSize;
    if (offset > bytes.length) break;
  }

  if (byteRate <= 0 || dataSize <= 0) return null;
  return dataSize / byteRate;
};

const shouldRetryQuotaFailure = (status, detail) => {
  const message = String(detail || '').toLowerCase();
  if (status === 429) return true;
  if (status < 500) return false;
  return (
    message.includes('resource_exhausted')
    || message.includes('quota exceeded')
    || message.includes('requests per minute')
    || message.includes('rate_limited')
    || message.includes('tts_rpm_limit')
    || message.includes('credentials were exhausted')
  );
};

const requestAudio = async (payload, label) => {
  for (let attempt = 1; attempt <= maxRetryAttempts; attempt += 1) {
    const response = await fetch(streamUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dev-uid': devUid,
        'x-dev-email': devEmail,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const bytes = await readStreamedAudio(response, label);
      if (bytes.length <= 0) {
        throw new Error('SSE synthesis succeeded but returned empty audio payload.');
      }
      return bytes;
    }

    const detail = await response.text().catch(() => '');
    if (attempt < maxRetryAttempts && shouldRetryQuotaFailure(response.status, detail)) {
      const waitMs = Math.min(retryMaxMs, retryBaseMs * attempt);
      console.warn(
        `[app-demos] quota-limited ${label} (status=${response.status}) attempt ${attempt}/${maxRetryAttempts}; retry in ${Math.ceil(waitMs / 1000)}s`,
      );
      await wait(waitMs);
      continue;
    }

    throw new Error(`SSE synthesis failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  throw new Error(`SSE synthesis failed after ${maxRetryAttempts} attempts.`);
};

const cleanDemoDirectory = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.wav') && !lower.endsWith('.mp3') && !lower.endsWith('.ogg')) {
      return;
    }
    await fs.unlink(path.join(dir, entry.name));
  }));
};

const run = async () => {
  console.log(`[app-demos] stream endpoint: ${streamUrl}`);
  console.log(`[app-demos] using dev uid: ${devUid}`);

  await cleanDemoDirectory(singleDir);
  await cleanDemoDirectory(multiDir);
  await cleanDemoDirectory(readerDir);

  const singleManifestSamples = [];
  for (const demo of singleSpeakerDemos) {
    const outName = `${demo.slug}.wav`;
    const outPath = path.join(singleDir, outName);
    console.log(`[app-demos] generating single: ${demo.slug} (${demo.voice})`);
    const audio = await requestAudio({
      mode: 'studio',
      text: demo.text,
      voice: demo.voice,
      language: demo.payloadLanguage || defaultLanguage,
      engine: defaultEngine,
      speed: 1,
    }, `single:${demo.slug}`);
    await fs.writeFile(outPath, audio);

    singleManifestSamples.push({
      slug: demo.slug,
      title: demo.title,
      summary: demo.summary,
      language: demo.language,
      country: demo.country,
      code: demo.payloadLanguage || defaultLanguage,
      file: `/audio/vector-demo/${outName}`,
      generatedWith: {
        source: 'app-studio-api',
        endpoint: '/api/v1/studio/tts/stream',
        engine: defaultEngine,
        voiceName: demo.voice,
        payloadLanguage: demo.payloadLanguage || defaultLanguage,
      },
    });
  }

  const multiManifestEntries = [];
  for (const demo of multiSpeakerDemos) {
    const outName = `${demo.id}.wav`;
    const outPath = path.join(multiDir, outName);
    const speakerConfigs = demo.speakers.map((speaker) => ({
      speaker,
      voice: speakerVoices[speaker] || 'Kore',
    }));

    console.log(`[app-demos] generating multi: ${demo.id}`);
    const audio = await requestAudio({
      mode: 'studio',
      text: demo.script,
      voice: speakerVoices.Neha,
      language: demo.payloadLanguage || defaultLanguage,
      engine: defaultEngine,
      speed: 1,
      speakerConfigs,
    }, `multi:${demo.id}`);
    await fs.writeFile(outPath, audio);

    multiManifestEntries.push({
      id: demo.id,
      title: demo.title,
      language: demo.language,
      market: demo.market,
      useCase: demo.useCase,
      scenario: demo.scenario,
      direction: demo.direction,
      summary: demo.summary,
      translation: 'N/A',
      audioSrc: `/audio/vector-multi-demo/${outName}`,
      cast: demo.speakers.map((speaker, index) => ({
        speaker,
        role: `Voice ${index + 1}`,
        displayName: `Voice ${index + 1}`,
        voiceId: speakerVoices[speaker] || 'Kore',
      })),
      lines: demo.lines.map((line) => ({
        speaker: line.speaker,
        role: `Voice ${demo.speakers.indexOf(line.speaker) + 1}`,
        text: line.text,
      })),
    });
  }

  const readerOutName = `${readerDemoSample.id}.wav`;
  const readerOutPath = path.join(readerDir, readerOutName);

  console.log(`[app-demos] generating reader sample: ${readerDemoSample.id} (${readerDemoSample.voice})`);
  const readerAudio = await requestAudio({
    mode: 'studio',
    text: readerDemoSample.text,
    voice: readerDemoSample.voice,
    language: readerDemoSample.locale,
    engine: defaultEngine,
    speed: 1,
  }, `reader:${readerDemoSample.id}`);
  await fs.writeFile(readerOutPath, readerAudio);

  const readerDurationSec = parseWavDurationSeconds(readerAudio);
  if (!Number.isFinite(readerDurationSec)) {
    throw new Error(`Reader demo duration could not be parsed from generated WAV: ${readerDemoSample.id}`);
  }

  if (readerDurationSec < readerDemoMinDurationSec || readerDurationSec > readerDemoMaxDurationSec) {
    throw new Error(
      `Reader demo duration ${readerDurationSec.toFixed(2)}s is out of range ${readerDemoMinDurationSec}-${readerDemoMaxDurationSec}s for ${readerDemoSample.id}`,
    );
  }

  const chapterManifestEntries = [];
  for (const chapter of virtualReaderBook.chapters) {
    const chapterOutName = `${chapter.id}.wav`;
    const chapterOutPath = path.join(readerDir, chapterOutName);

    console.log(`[app-demos] generating reader chapter: ${chapter.id} (${chapter.voice})`);
    const chapterAudio = await requestAudio({
      mode: 'studio',
      text: chapter.text,
      voice: chapter.voice,
      language: virtualReaderBook.locale,
      engine: defaultEngine,
      speed: 1,
    }, `reader-chapter:${chapter.id}`);
    await fs.writeFile(chapterOutPath, chapterAudio);

    const chapterDurationSec = parseWavDurationSeconds(chapterAudio);
    if (!Number.isFinite(chapterDurationSec)) {
      throw new Error(`Reader chapter duration could not be parsed from generated WAV: ${chapter.id}`);
    }

    if (chapterDurationSec < readerChapterMinDurationSec || chapterDurationSec > readerChapterMaxDurationSec) {
      throw new Error(
        `Reader chapter duration ${chapterDurationSec.toFixed(2)}s is out of range ${readerChapterMinDurationSec}-${readerChapterMaxDurationSec}s for ${chapter.id}`,
      );
    }

    chapterManifestEntries.push({
      id: chapter.id,
      order: chapter.order,
      title: chapter.title,
      summary: chapter.summary,
      cue: chapter.cue,
      audioSrc: `/audio/reader-demo/${chapterOutName}`,
      durationSec: Number(chapterDurationSec.toFixed(2)),
      script: chapter.text,
      generatedWith: {
        source: 'app-studio-api',
        endpoint: '/api/v1/studio/tts/stream',
        engine: defaultEngine,
        voiceName: chapter.voice,
        payloadLanguage: virtualReaderBook.locale,
        speed: 1,
      },
    });
  }

  const generatedAt = new Date().toISOString();

  const singleManifest = {
    generatedAt,
    runtimeSynthesizeUrl: streamUrl,
    engine: defaultEngine,
    voiceName: 'App studio voices',
    samples: singleManifestSamples,
  };

  const multiManifest = {
    generatedAt,
    engine: 'App studio multi-speaker',
    selectionNote: 'Generated through app studio synth API with Aryan/Puck, Neha/Kore, Raj/Charon, Priya/Zephyr.',
    featuredIds: multiManifestEntries.map((entry) => entry.id),
    entries: multiManifestEntries,
  };

  const readerManifest = {
    generatedAt,
    runtimeSynthesizeUrl: streamUrl,
    engine: defaultEngine,
    expectedDurationRangeSec: {
      min: readerDemoMinDurationSec,
      max: readerDemoMaxDurationSec,
    },
    expectedChapterDurationRangeSec: {
      min: readerChapterMinDurationSec,
      max: readerChapterMaxDurationSec,
    },
    sample: {
      id: readerDemoSample.id,
      title: readerDemoSample.title,
      summary: readerDemoSample.summary,
      language: readerDemoSample.language,
      locale: readerDemoSample.locale,
      audioSrc: `/audio/reader-demo/${readerOutName}`,
      posterSrc: readerDemoSample.posterSrc,
      cue: readerDemoSample.cue,
      durationSec: Number(readerDurationSec.toFixed(2)),
      script: readerDemoSample.text,
      generatedWith: {
        source: 'app-studio-api',
        endpoint: '/api/v1/studio/tts/stream',
        engine: defaultEngine,
        voiceName: readerDemoSample.voice,
        payloadLanguage: readerDemoSample.locale,
        speed: 1,
      },
    },
    virtualBook: {
      id: virtualReaderBook.id,
      title: virtualReaderBook.title,
      author: virtualReaderBook.author,
      language: virtualReaderBook.language,
      locale: virtualReaderBook.locale,
      description: virtualReaderBook.description,
      coverSrc: virtualReaderBook.coverSrc,
      totalChapters: virtualReaderBook.chapters.length,
    },
    chapters: chapterManifestEntries,
  };

  await writeTextFileWithRetry(path.join(singleDir, 'manifest.json'), `${JSON.stringify(singleManifest, null, 2)}\n`);
  await writeTextFileWithRetry(path.join(multiDir, 'manifest.json'), `${JSON.stringify(multiManifest, null, 2)}\n`);
  await writeTextFileWithRetry(path.join(readerDir, 'manifest.json'), `${JSON.stringify(readerManifest, null, 2)}\n`);

  console.log(
    `[app-demos] complete: ${singleManifestSamples.length} single + ${multiManifestEntries.length} multi demos + reader sample ${readerDemoSample.id} (${readerDurationSec.toFixed(2)}s) + ${chapterManifestEntries.length} reader chapters from ${virtualReaderBook.id}.`,
  );
};

run().catch((error) => {
  console.error(`[app-demos] failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
