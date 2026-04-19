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

const projectRoot = process.cwd();
const singleDir = path.join(projectRoot, 'frontend', 'public', 'audio', 'vector-demo');
const multiDir = path.join(projectRoot, 'frontend', 'public', 'audio', 'vector-multi-demo');

const speakerVoices = {
  // Multi-speaker demo cast — English: The AI Debate
  Maya: 'Puck',
  Dev: 'Charon',
  Zara: 'Kore',
  Kai: 'Zephyr',
  // Multi-speaker demo cast — Hindi: Chai Pe Charcha
  Vikram: 'Fenrir',
  Ananya: 'Kore',
  Kabir: 'Puck',
  // Multi-speaker demo cast — Spanish: La Receta Secreta
  Carmen: 'Zephyr',
  Luis: 'Charon',
  // Multi-speaker demo cast — English: Mission Control
  Commander: 'Alnilam',
  Houston: 'Orus',
  Pilot: 'Leda',
};

const singleSpeakerDemos = [
  {
    slug: 'future-is-now-en',
    title: 'The Future Is Now',
    summary: 'A visionary tech keynote opener that showcases confident, energetic delivery.',
    language: 'English',
    country: 'United States',
    payloadLanguage: 'en-US',
    voice: 'Puck',
    text: 'Imagine a world where your ideas become reality the moment you speak them. Where a single sentence transforms into a symphony of voices — each one distinct, each one alive. That world is not coming. It is here. Welcome to the next generation of voice.',
  },
  {
    slug: 'mumbai-baarish-hi',
    title: 'Mumbai ki Baarish',
    summary: 'A poetic Hindi narration capturing the magic of Mumbai monsoons.',
    language: 'Hindi',
    country: 'India',
    payloadLanguage: 'hi-IN',
    voice: 'Kore',
    text: 'मुंबई की बारिश कुछ अलग ही होती है। पहली बूँद गिरती है और पूरा शहर ठहर जाता है। चाय की दुकानों पर भीड़ लग जाती है, ट्रेनें धीमी हो जाती हैं, और बच्चे सड़कों पर नाचने लगते हैं। यह बारिश सिर्फ पानी नहीं है — यह मुंबई की धड़कन है।',
  },
  {
    slug: 'noche-flamenco-es',
    title: 'Noche de Flamenco',
    summary: 'A vivid Spanish narration of a flamenco night that pulses with rhythm and emotion.',
    language: 'Spanish',
    country: 'Spain',
    payloadLanguage: 'es-ES',
    voice: 'Zephyr',
    text: 'La guitarra comienza con un susurro. Los tacones golpean el suelo como un corazón que despierta. La bailaora levanta los brazos y el silencio se rompe en mil pedazos. Esta noche, el flamenco no se baila — se vive. Cada nota cuenta una historia que las palabras no pueden.',
  },
  {
    slug: 'sakura-season-ja',
    title: '桜の季節',
    summary: 'A serene Japanese meditation on cherry blossom season and fleeting beauty.',
    language: 'Japanese',
    country: 'Japan',
    payloadLanguage: 'ja-JP',
    voice: 'Achernar',
    text: '春が来ると、街は薄桃色に染まります。一枚一枚の花びらが風に舞い、川面を静かに流れていきます。人々は桜の下に集まり、お茶を飲み、笑い合います。この一瞬の美しさこそが、日本の春の本質です。',
  },
  {
    slug: 'carnaval-ritmo-pt',
    title: 'Ritmo do Carnaval',
    summary: 'An energetic Portuguese narration bursting with the pulse of Rio Carnival.',
    language: 'Portuguese',
    country: 'Brazil',
    payloadLanguage: 'pt-BR',
    voice: 'Algenib',
    text: 'O tambor começa baixinho, quase um segredo. Depois vem o surdo, forte como o coração da cidade. As cores explodem na avenida e os corpos se movem como se não houvesse amanhã. No carnaval do Rio, não existe plateia — todo mundo dança, todo mundo canta, todo mundo vive.',
  },
  {
    slug: 'alpenmorgen-de',
    title: 'Alpenmorgen',
    summary: 'A documentary-style German narration of an Alpine dawn, quiet and precise.',
    language: 'German',
    country: 'Germany',
    payloadLanguage: 'de-DE',
    voice: 'Rasalgethi',
    text: 'Der erste Sonnenstrahl trifft den Gipfel, und die Alpen erwachen. Nebel steigt aus den Tälern auf wie ein langsamer Atem. Die Kuhglocken läuten in der Ferne, und der Geruch von frischem Heu liegt in der Luft. Hier oben, über den Wolken, beginnt jeder Tag wie ein stilles Versprechen.',
  },
  {
    slug: 'matin-paris-fr',
    title: 'Un Matin à Paris',
    summary: 'A cinematic French narration of a Parisian morning, warm and literary.',
    language: 'French',
    country: 'France',
    payloadLanguage: 'fr-FR',
    voice: 'Sadaltager',
    text: "Le jour se lève sur les toits de Paris. L'odeur du café frais se mêle à celle des croissants dorés. Un violoniste joue doucement près du pont. Les feuilles d'automne dansent sur les pavés, et la Seine brille comme un ruban d'argent. Paris ne se réveille pas — elle murmure.",
  },
  {
    slug: 'desert-stars-ar',
    title: 'نجوم الصحراء',
    summary: 'A poetic Arabic narration of the Arabian desert under a canopy of stars.',
    language: 'Arabic',
    country: 'UAE',
    payloadLanguage: 'ar-XA',
    voice: 'Umbriel',
    text: 'عندما تغيب الشمس عن الصحراء، يبدأ عرض آخر. ملايين النجوم تضيء السماء وكأنها لوحة رسمها فنان لا ينام. الرمال تبرد تحت قدميك، والهواء يحمل رائحة البخور. في هذا الصمت العظيم، تسمع صوت الكون يتحدث.',
  },
];

const multiSpeakerDemos = [
  {
    id: 'en-ai-debate',
    title: 'The AI Debate',
    language: 'English',
    market: 'Global English',
    payloadLanguage: 'en-US',
    useCase: 'Podcast discussion',
    scenario: 'AI creativity debate',
    direction: 'A lively four-voice podcast panel debating AI and creativity with natural interruptions and genuine curiosity.',
    summary: 'Four hosts debate whether AI can truly be creative, with thoughtful arguments and playful energy.',
    speakers: ['Maya', 'Dev', 'Zara', 'Kai'],
    script: [
      'Maya: [enthusiastically] Welcome back to The Signal! Today\'s big question — can AI actually be creative, or is it just really good at copying?',
      'Dev: [thoughtfully] I mean, creativity requires intent, right? AI doesn\'t want to create. It just predicts the next token.',
      'Zara: [challenging] But does intent matter if the output moves people? A sunset doesn\'t intend to be beautiful.',
      '<break time="400ms"/>',
      'Dev: [pauses] That\'s... actually a good point.',
      'Kai: [casually] Here\'s what I think. AI is a tool. The best paintbrush in the world doesn\'t make you Picasso.',
      'Maya: [curious] So the human is still the artist?',
      'Kai: [warmly] Always. The tool just got a massive upgrade.',
      'Zara: [bright] And honestly? That\'s exciting, not scary.',
      'Maya: [energetically] Love that take. More after the break — don\'t go anywhere!',
    ].join('\n'),
    lines: [
      { speaker: 'Maya', text: '[enthusiastically] Welcome back to The Signal! Today\'s big question — can AI actually be creative, or is it just really good at copying?' },
      { speaker: 'Dev', text: '[thoughtfully] I mean, creativity requires intent, right? AI doesn\'t want to create. It just predicts the next token.' },
      { speaker: 'Zara', text: '[challenging] But does intent matter if the output moves people? A sunset doesn\'t intend to be beautiful.' },
      { speaker: 'Dev', text: '[pauses] That\'s... actually a good point.' },
      { speaker: 'Kai', text: '[casually] Here\'s what I think. AI is a tool. The best paintbrush in the world doesn\'t make you Picasso.' },
      { speaker: 'Maya', text: '[curious] So the human is still the artist?' },
      { speaker: 'Kai', text: '[warmly] Always. The tool just got a massive upgrade.' },
      { speaker: 'Zara', text: '[bright] And honestly? That\'s exciting, not scary.' },
      { speaker: 'Maya', text: '[energetically] Love that take. More after the break — don\'t go anywhere!' },
    ],
  },
  {
    id: 'hi-chai-charcha',
    title: 'Chai Pe Charcha',
    language: 'Hindi',
    market: 'India Hindi',
    payloadLanguage: 'hi-IN',
    useCase: 'Casual conversation',
    scenario: 'Friends planning a trip over tea',
    direction: 'Warm, playful banter between three friends with natural Hindi speech rhythms and casual energy.',
    summary: 'Three friends argue over weekend plans while drinking chai — fun, warm, and totally relatable.',
    speakers: ['Vikram', 'Ananya', 'Kabir'],
    script: [
      'Vikram: [excitedly] Yaar sunno sunno — iss weekend Goa chalte hain! Tickets saste mil rahe hain!',
      'Ananya: [skeptically] Goa? Phir se? Pichli baar bhi toh hum wahi gaye the.',
      'Vikram: [persuasively] Arrey par iss baar South Goa chalenge — bilkul alag vibe hai wahan ki.',
      'Kabir: [lazily] Bhai mujhe toh bas AC room chahiye aur achha khana. Baaki tum decide karo.',
      '<break time="300ms"/>',
      'Ananya: [laughing] Kabir tu har trip mein yahi bolta hai!',
      'Kabir: [innocently] Kyunki yahi sach hai! Simple insaan hoon main.',
      'Vikram: [warmly] Chal theek hai — main sab book karta hoon. Bas Friday shaam nikalna hai.',
      'Ananya: [happily] Done! Chai khatam karo pehle phir planning karte hain.',
    ].join('\n'),
    lines: [
      { speaker: 'Vikram', text: '[excitedly] Yaar sunno sunno — iss weekend Goa chalte hain! Tickets saste mil rahe hain!' },
      { speaker: 'Ananya', text: '[skeptically] Goa? Phir se? Pichli baar bhi toh hum wahi gaye the.' },
      { speaker: 'Vikram', text: '[persuasively] Arrey par iss baar South Goa chalenge — bilkul alag vibe hai wahan ki.' },
      { speaker: 'Kabir', text: '[lazily] Bhai mujhe toh bas AC room chahiye aur achha khana. Baaki tum decide karo.' },
      { speaker: 'Ananya', text: '[laughing] Kabir tu har trip mein yahi bolta hai!' },
      { speaker: 'Kabir', text: '[innocently] Kyunki yahi sach hai! Simple insaan hoon main.' },
      { speaker: 'Vikram', text: '[warmly] Chal theek hai — main sab book karta hoon. Bas Friday shaam nikalna hai.' },
      { speaker: 'Ananya', text: '[happily] Done! Chai khatam karo pehle phir planning karte hain.' },
    ],
  },
  {
    id: 'es-receta-secreta',
    title: 'La Receta Secreta',
    language: 'Spanish',
    market: 'Spain Spanish',
    payloadLanguage: 'es-ES',
    useCase: 'Cooking show',
    scenario: 'Chef reveals a secret family recipe on live TV',
    direction: 'Warm nostalgia meets playful banter — a chef and host sharing a family treasure on air.',
    summary: 'A Spanish cooking show where a chef reveals her grandmother\'s secret paella recipe with warmth and mystery.',
    speakers: ['Carmen', 'Luis'],
    script: [
      'Carmen: [warmly] Bienvenidos a mi cocina. Hoy les voy a enseñar algo muy especial — la paella de mi abuela.',
      'Luis: [curious] Carmen, dicen que tu abuela nunca compartió esta receta con nadie.',
      'Carmen: [nostalgically] Es verdad. Me la susurró al oído cuando yo tenía diez años. Dijo — solo cocínala cuando tengas a alguien a quien quieras impresionar.',
      '<break time="400ms"/>',
      'Luis: [impressed] ¿Y cuál es el secreto?',
      'Carmen: [mysteriously] El secreto no está en los ingredientes, Luis. Está en la paciencia. El arroz tiene que escuchar el fuego.',
      'Luis: [playfully] ¡Escuchar el fuego! Eso es poesía pura.',
      'Carmen: [laughing] ¡La buena cocina siempre es poesía!',
    ].join('\n'),
    lines: [
      { speaker: 'Carmen', text: '[warmly] Bienvenidos a mi cocina. Hoy les voy a enseñar algo muy especial — la paella de mi abuela.' },
      { speaker: 'Luis', text: '[curious] Carmen, dicen que tu abuela nunca compartió esta receta con nadie.' },
      { speaker: 'Carmen', text: '[nostalgically] Es verdad. Me la susurró al oído cuando yo tenía diez años. Dijo — solo cocínala cuando tengas a alguien a quien quieras impresionar.' },
      { speaker: 'Luis', text: '[impressed] ¿Y cuál es el secreto?' },
      { speaker: 'Carmen', text: '[mysteriously] El secreto no está en los ingredientes, Luis. Está en la paciencia. El arroz tiene que escuchar el fuego.' },
      { speaker: 'Luis', text: '[playfully] ¡Escuchar el fuego! Eso es poesía pura.' },
      { speaker: 'Carmen', text: '[laughing] ¡La buena cocina siempre es poesía!' },
    ],
  },
  {
    id: 'en-mission-control',
    title: 'Mission Control',
    language: 'English',
    market: 'Global English',
    payloadLanguage: 'en-US',
    useCase: 'Drama scene',
    scenario: 'Space mission lunar descent',
    direction: 'Tense, precise military cadence building to an emotional touchdown — three distinct voices under pressure.',
    summary: 'A gripping three-voice space mission countdown from orbit to lunar touchdown.',
    speakers: ['Commander', 'Houston', 'Pilot'],
    script: [
      'Commander: [calmly] Mission Control, this is Artemis Seven. We have visual on the landing zone. Requesting final go for descent.',
      'Houston: [professionally] Artemis Seven, Houston confirms. All systems nominal. You are go for powered descent. Good luck up there.',
      'Commander: [focused] Copy that. Initiating descent sequence. Altitude twelve thousand meters and dropping.',
      '<break time="500ms"/>',
      'Pilot: [alert] Commander, wind shear detected at eight thousand. Adjusting trajectory by point three degrees.',
      'Commander: [steady] Acknowledged. Compensating now. Fuel is nominal. We are on the glide path.',
      'Houston: [tensely] Artemis Seven, you are passing through five thousand meters. Looking good from down here.',
      'Pilot: [excited] Terrain scan complete — landing pad is clear! Two thousand meters!',
      'Commander: [firmly] Cutting main engines. Switching to hover thrusters. Contact light — we are down!',
      'Houston: [elated] Artemis Seven, Houston confirms touchdown! Outstanding work, crew!',
    ].join('\n'),
    lines: [
      { speaker: 'Commander', text: '[calmly] Mission Control, this is Artemis Seven. We have visual on the landing zone. Requesting final go for descent.' },
      { speaker: 'Houston', text: '[professionally] Artemis Seven, Houston confirms. All systems nominal. You are go for powered descent. Good luck up there.' },
      { speaker: 'Commander', text: '[focused] Copy that. Initiating descent sequence. Altitude twelve thousand meters and dropping.' },
      { speaker: 'Pilot', text: '[alert] Commander, wind shear detected at eight thousand. Adjusting trajectory by point three degrees.' },
      { speaker: 'Commander', text: '[steady] Acknowledged. Compensating now. Fuel is nominal. We are on the glide path.' },
      { speaker: 'Houston', text: '[tensely] Artemis Seven, you are passing through five thousand meters. Looking good from down here.' },
      { speaker: 'Pilot', text: '[excited] Terrain scan complete — landing pad is clear! Two thousand meters!' },
      { speaker: 'Commander', text: '[firmly] Cutting main engines. Switching to hover thrusters. Contact light — we are down!' },
      { speaker: 'Houston', text: '[elated] Artemis Seven, Houston confirms touchdown! Outstanding work, crew!' },
    ],
  },
];

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
    selectionNote: 'Generated through app studio synth API with expanded global voice cast.',
    featuredIds: multiManifestEntries.map((entry) => entry.id),
    entries: multiManifestEntries,
  };

  await writeTextFileWithRetry(path.join(singleDir, 'manifest.json'), `${JSON.stringify(singleManifest, null, 2)}\n`);
  await writeTextFileWithRetry(path.join(multiDir, 'manifest.json'), `${JSON.stringify(multiManifest, null, 2)}\n`);

  console.log(
    `[app-demos] complete: ${singleManifestSamples.length} single + ${multiManifestEntries.length} multi demos.`,
  );
};

run().catch((error) => {
  console.error(`[app-demos] failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
