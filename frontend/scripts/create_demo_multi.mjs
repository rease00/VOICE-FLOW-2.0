import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import util from 'util';
import path from 'path';

// Set up Google Cloud TTS Client
const client = new textToSpeech.TextToSpeechClient();

const SCRIPT = [
  { speaker: 'en-US-Journey-F', text: "The new V FLOW AI platform launched today. Users are generating thousands of scenes without any watermarks!" },
  { speaker: 'en-US-Journey-D', text: "Did you see the new aurora theme? It looks absolutely stunning on all devices!" },
  { speaker: 'en-US-Journey-F', text: "Yes, the Deep Space UI makes producing multi-speaker novels a breeze." }
];

async function generate() {
  const parts = [];
  for (const block of SCRIPT) {
    const request = {
      input: { text: block.text },
      voice: { languageCode: 'en-US', name: block.speaker },
      audioConfig: { audioEncoding: 'MP3' },
    };
    console.log(`Generating: ${block.speaker}`);
    const [response] = await client.synthesizeSpeech(request);
    parts.push(response.audioContent);
  }

  // Concatenate MP3 binary buffers (simple concatenation works for generic playback, or we write them sequentially)
  const fullMp3 = Buffer.concat(parts);
  const outPath = path.resolve('./public/audio/demo/ai_director_multi.mp3');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fullMp3, 'binary');
  console.log(`Saved to ${outPath}`);
}

generate().catch(console.error);
