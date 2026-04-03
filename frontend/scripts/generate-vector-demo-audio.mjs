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
    text: '<tone="cheerful"><mood="bright">Good morning! <pause="400ms"/> I have updated your schedule for today. You have a coffee meeting at ten, and <tone="playful">do not forget your umbrella, it looks like rain is on the way!</tone> Shall I play your morning playlist?</mood></tone>',
  },
  {
    slug: 'hi',
    language: 'Hindi',
    country: 'India',
    code: 'hi',
    text: '<tone="empathetic"><mood="calm"><speed="gentle">नमस्ते, मैं आपकी क्या सहायता कर सकता हूँ? <pause="500ms"/> आपकी समस्या सुनकर मुझे खेद है, लेकिन <tone="reassuring">आप चिंता न करें। मैं अभी आपके रिफंड की स्थिति चेक करता हूँ। बस एक मिनट इंतज़ार कीजिए।</tone></speed></mood></tone>',
  },
  {
    slug: 'es',
    language: 'Spanish',
    country: 'Spain',
    code: 'es',
    text: '<tone="informative"><mood="friendly">¡Hola! Tu pedido está a solo dos minutos de distancia. <pause="300ms"/> <tone="excited">¡Ya casi puedes oler la pizza!</tone> Por favor, asegúrate de tener tu teléfono a mano por si el repartidor necesita llamarte. ¡Que aproveche!</mood></tone>',
  },
  {
    slug: 'ja',
    language: 'Japanese',
    country: 'Japan',
    code: 'ja',
    text: '<tone="respectful"><mood="focused">お疲れ様です。 <pause="600ms"/> まもなく午後の会議が始まります。 <tone="reminding">準備はよろしいでしょうか？ 必要な資料はすべてタブレットに送信済みですので、ご確認ください。 それでは、いってらっしゃいませ。</tone></mood></tone>',
  },
  {
    slug: 'fr',
    language: 'French',
    country: 'France',
    code: 'fr',
    text: '<tone="smooth"><mood="dreamy"><breathing="natural">Imaginez une plage déserte au coucher du soleil. <pause="700ms"/> Écoutez le bruit des vagues. <tone="warm">C\'est le moment idéal pour lâcher prise.</tone> Souhaitez-vous commencer votre séance de méditation guidée maintenant ?</breathing></mood></tone>',
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

