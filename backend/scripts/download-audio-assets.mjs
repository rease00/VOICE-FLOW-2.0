#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MUSIC_ASSETS = [
  {
    id: "m_cinematic_melody",
    name: "Cinematic Melody",
    category: "Cinematic",
    sourceUrl: "https://cdn.pixabay.com/audio/2021/10/23/audio_fa974e579a.mp3",
    targetPath: "public/assets/audio/music/cinematic_melody.mp3",
  },
  {
    id: "m_just_relax",
    name: "Just Relax",
    category: "Calm",
    sourceUrl: "https://cdn.pixabay.com/audio/2021/11/23/audio_64b2dd1bce.mp3",
    targetPath: "public/assets/audio/music/just_relax.mp3",
  },
  {
    id: "m_beyond_horizons",
    name: "Beyond Horizons",
    category: "Cinematic",
    sourceUrl: "https://cdn.pixabay.com/audio/2024/04/11/audio_825f6f9a35.mp3",
    targetPath: "public/assets/audio/music/beyond_horizons.mp3",
  },
  {
    id: "m_autumn_piano",
    name: "Autumn Piano",
    category: "Calm",
    sourceUrl: "https://cdn.pixabay.com/audio/2023/09/05/audio_8cfcc17b8c.mp3",
    targetPath: "public/assets/audio/music/autumn_is_coming_piano.mp3",
  },
  {
    id: "m_lofi",
    name: "Lo-Fi Chill",
    category: "Lo-Fi",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3",
    targetPath: "public/assets/audio/music/lofi_chill.mp3",
  },
  {
    id: "m_corporate_upbeat",
    name: "Corporate Upbeat",
    category: "Upbeat",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3",
    targetPath: "public/assets/audio/music/corporate_upbeat.mp3",
  },
  {
    id: "m_chill_synthwave",
    name: "Chill Synthwave",
    category: "Electronic",
    sourceUrl: "https://cdn.pixabay.com/audio/2024/04/11/audio_c4c79fe54e.mp3",
    targetPath: "public/assets/audio/music/chill_synthwave_80x.mp3",
  },
  {
    id: "m_soaring_heights",
    name: "Soaring Heights",
    category: "Cinematic",
    sourceUrl: "https://cdn.pixabay.com/audio/2024/05/08/audio_373e05c162.mp3",
    targetPath: "public/assets/audio/music/soaring_heights.mp3",
  },
];

const SFX_ASSETS = [
  {
    id: "level_up",
    name: "Level Up",
    category: "UI",
    sourceUrl: "https://cdn.pixabay.com/audio/2024/04/01/audio_e939eebbb1.mp3",
    targetPath: "public/assets/audio/sfx/level_up.mp3",
  },
  {
    id: "punch",
    name: "Punch Hit",
    category: "Impacts",
    sourceUrl: "https://cdn.pixabay.com/audio/2023/02/22/audio_d7a43e9b3b.mp3",
    targetPath: "public/assets/audio/sfx/punch_hit.mp3",
  },
  {
    id: "scream",
    name: "Scream",
    category: "Horror",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/03/15/audio_de85bac61d.mp3",
    targetPath: "public/assets/audio/sfx/scream.mp3",
  },
  {
    id: "boost",
    name: "Boost Transition",
    category: "Transitions",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/03/24/audio_f57273b4d6.mp3",
    targetPath: "public/assets/audio/sfx/boost_transition.mp3",
  },
  {
    id: "whoosh",
    name: "Whoosh",
    category: "Transitions",
    sourceUrl: "https://cdn.pixabay.com/audio/2025/07/30/audio_b3087a581e.mp3",
    targetPath: "public/assets/audio/sfx/whoosh.mp3",
  },
  {
    id: "applause_cheer",
    name: "Applause Cheer",
    category: "Crowd",
    sourceUrl: "https://cdn.pixabay.com/audio/2024/08/31/audio_aa510c96aa.mp3",
    targetPath: "public/assets/audio/sfx/applause_cheer.mp3",
  },
  {
    id: "dog_bark",
    name: "Dog Bark",
    category: "Animals",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/03/15/audio_aa4b5cc81b.mp3",
    targetPath: "public/assets/audio/sfx/dog_bark.mp3",
  },
  {
    id: "sliding_door",
    name: "Sliding Door",
    category: "Doors",
    sourceUrl: "https://cdn.pixabay.com/audio/2021/08/04/audio_c92a7a25af.mp3",
    targetPath: "public/assets/audio/sfx/sliding_door.mp3",
  },
  {
    id: "door_open_close",
    name: "Door Open Close",
    category: "Doors",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/03/10/audio_1394a10e86.mp3",
    targetPath: "public/assets/audio/sfx/door_open_close.mp3",
  },
  {
    id: "door_lock",
    name: "Door Lock",
    category: "Doors",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/03/10/audio_6454d7af21.mp3",
    targetPath: "public/assets/audio/sfx/door_lock.mp3",
  },
  {
    id: "light_rain",
    name: "Light Rain",
    category: "Environment",
    sourceUrl: "https://cdn.pixabay.com/audio/2022/04/16/audio_520eb6a5cc.mp3",
    targetPath: "public/assets/audio/sfx/light_rain.mp3",
  },
];

const ALL_ASSETS = [
  ...MUSIC_ASSETS.map((item) => ({ ...item, type: "music" })),
  ...SFX_ASSETS.map((item) => ({ ...item, type: "sfx" })),
];

async function ensureDirFor(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function downloadAsset(asset, force) {
  const targetAbs = path.join(ROOT, asset.targetPath);
  try {
    if (!force) {
      await fs.access(targetAbs);
      console.log(`[skip] ${asset.targetPath}`);
      return;
    }
  } catch {
    // file missing -> continue
  }

  console.log(`[download] ${asset.targetPath}`);
  const response = await fetch(asset.sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed ${asset.sourceUrl} -> ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await ensureDirFor(targetAbs);
  await fs.writeFile(targetAbs, bytes);
}

async function writeManifest() {
  const manifest = {
    generatedAt: new Date().toISOString(),
    license: "Pixabay License",
    note: "Audio files are downloaded from cdn.pixabay.com and served locally for reliable playback.",
    assets: ALL_ASSETS,
  };
  const target = path.join(ROOT, "data", "audio-asset-manifest.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(manifest, null, 2), "utf8");
}

async function main() {
  const force = process.argv.includes("--force");
  for (const asset of ALL_ASSETS) {
    // eslint-disable-next-line no-await-in-loop
    await downloadAsset(asset, force);
  }
  await writeManifest();
  console.log(`Completed ${ALL_ASSETS.length} audio assets.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
