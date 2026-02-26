#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '..', '..');

export const nowIso = () => new Date().toISOString();

export const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

export const writeJsonFile = async (filePath, value) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

export const median = (numbers) => {
  const vals = (numbers || []).filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  if (vals.length % 2 === 0) return (vals[mid - 1] + vals[mid]) / 2;
  return vals[mid];
};

export const percentile = (numbers, pct) => {
  const vals = (numbers || []).filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const clampedPct = Math.max(0, Math.min(1, pct));
  const idx = clampedPct * (vals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return vals[lo];
  const ratio = idx - lo;
  return vals[lo] + (vals[hi] - vals[lo]) * ratio;
};

const extractAllNumbers = (text, regex) => {
  const out = [];
  for (const match of String(text || '').matchAll(regex)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
};

export const parseVolumedetectOutput = (logText) => {
  const maxVolumes = extractAllNumbers(logText, /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/gi);
  const meanVolumes = extractAllNumbers(logText, /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/gi);
  return {
    maxVolumeDb: maxVolumes.length ? maxVolumes[maxVolumes.length - 1] : null,
    meanVolumeDb: meanVolumes.length ? meanVolumes[meanVolumes.length - 1] : null,
    maxVolumeSamples: maxVolumes.length,
    meanVolumeSamples: meanVolumes.length,
  };
};

export const parseEbur128Output = (logText) => {
  const integrated = extractAllNumbers(logText, /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS\b/gi);
  const lra = extractAllNumbers(logText, /\bLRA:\s*(-?\d+(?:\.\d+)?)\s*LU\b/gi);
  const peaks = extractAllNumbers(logText, /\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS\b/gi);
  return {
    integratedLufs: integrated.length ? integrated[integrated.length - 1] : null,
    lraLu: lra.length ? lra[lra.length - 1] : null,
    truePeakDbfs: peaks.length ? peaks[peaks.length - 1] : null,
  };
};

export const parseAstatsOutput = (logText) => {
  const rmsValues = extractAllNumbers(logText, /RMS level dB:\s*(-?\d+(?:\.\d+)?)/gi);
  const peakValues = extractAllNumbers(logText, /Peak level dB:\s*(-?\d+(?:\.\d+)?)/gi);
  const clippedValues = extractAllNumbers(logText, /Number of clipped samples:\s*(\d+)/gi);

  const rmsDb = median(rmsValues);
  const peakDb = peakValues.length ? Math.max(...peakValues) : null;
  const clippedSamples = clippedValues.length
    ? clippedValues.reduce((sum, value) => sum + value, 0)
    : 0;

  return {
    rmsDb,
    peakDb,
    clippedSamples,
    rmsSamples: rmsValues.length,
    peakSamples: peakValues.length,
    clippedSamplesEntries: clippedValues.length,
  };
};

export const runCommand = (command, args, options = {}) =>
  new Promise((resolve) => {
    const {
      cwd = ROOT,
      timeoutMs = 120_000,
      env = {},
      encoding = 'utf8',
    } = options;

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    let timedOut = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });

    child.on('error', (error) => {
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);
      finish({
        ok: false,
        code: -1,
        timedOut,
        stdout: encoding === 'buffer' ? '' : stdoutBuffer.toString('utf8'),
        stderr: `${stderrBuffer.toString('utf8')}\n${error instanceof Error ? error.message : String(error)}`.trim(),
        stdoutBuffer,
        stderrBuffer,
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // noop
      }
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const stderrBuffer = Buffer.concat(stderrChunks);
      finish({
        ok: Number(code) === 0 && !timedOut,
        code: Number(code ?? -1),
        timedOut,
        stdout: encoding === 'buffer' ? '' : stdoutBuffer.toString('utf8'),
        stderr: stderrBuffer.toString('utf8'),
        stdoutBuffer,
        stderrBuffer,
      });
    });
  });

export const fetchWithTimeout = async (url, init = {}, timeoutMs = 60_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const parseJsonOrText = async (response) => {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
};

export const fetchJson = async (url, init = {}, timeoutMs = 60_000) => {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  const payload = await parseJsonOrText(response);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new Error(`${url} returned non-JSON payload`);
  }
  return payload;
};

export const ffprobeDurationSeconds = async (filePath) => {
  const probe = await runCommand(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { timeoutMs: 35_000 }
  );

  if (!probe.ok) {
    throw new Error(`ffprobe failed for ${filePath}: ${(probe.stderr || probe.stdout || '').trim()}`);
  }

  const value = Number(String(probe.stdout || '').trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid duration from ffprobe for ${filePath}: ${probe.stdout}`);
  }
  return value;
};

export const validateAudioDecode = async (filePath) => {
  const result = await runCommand('ffmpeg', ['-v', 'error', '-i', filePath, '-f', 'null', '-'], {
    timeoutMs: 60_000,
  });
  return {
    ok: result.ok,
    error: result.ok ? null : (result.stderr || result.stdout || 'ffmpeg decode failed').trim(),
  };
};

export const analyzeWithVolumedetect = async (filePath) => {
  const result = await runCommand(
    'ffmpeg',
    ['-hide_banner', '-v', 'info', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'],
    { timeoutMs: 70_000 }
  );

  const log = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsed = parseVolumedetectOutput(log);
  return {
    ok: result.ok,
    error: result.ok ? null : (result.stderr || result.stdout || 'volumedetect failed').trim(),
    ...parsed,
  };
};

export const analyzeWithEbur128 = async (filePath) => {
  const result = await runCommand(
    'ffmpeg',
    ['-hide_banner', '-v', 'info', '-i', filePath, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'],
    { timeoutMs: 90_000 }
  );

  const log = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsed = parseEbur128Output(log);
  return {
    ok: result.ok,
    error: result.ok ? null : (result.stderr || result.stdout || 'ebur128 failed').trim(),
    ...parsed,
  };
};

export const analyzeWithAstats = async (filePath) => {
  const result = await runCommand(
    'ffmpeg',
    ['-hide_banner', '-v', 'info', '-i', filePath, '-af', 'astats=metadata=1:reset=1', '-f', 'null', '-'],
    { timeoutMs: 90_000 }
  );

  const log = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsed = parseAstatsOutput(log);
  return {
    ok: result.ok,
    error: result.ok ? null : (result.stderr || result.stdout || 'astats failed').trim(),
    ...parsed,
  };
};

export const decodeToMonoFloatSamples = async (filePath, sampleRate = 16_000) => {
  const result = await runCommand(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'],
    { timeoutMs: 90_000, encoding: 'buffer' }
  );

  if (!result.ok) {
    throw new Error(`Failed to decode PCM samples for ${filePath}: ${(result.stderr || '').trim()}`);
  }

  const buffer = result.stdoutBuffer || Buffer.alloc(0);
  const usable = Math.floor(buffer.length / 4) * 4;
  if (usable <= 0) return new Float32Array(0);

  const trimmed = buffer.subarray(0, usable);
  const view = new Float32Array(trimmed.buffer, trimmed.byteOffset, usable / 4);
  return Float32Array.from(view);
};

const toDb = (value) => 20 * Math.log10(Math.max(1e-9, value));

export const computeWindowedEnergyMetrics = (samples, sampleRate, windowSec = 0.2) => {
  if (!(samples instanceof Float32Array) || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return {
      windowCount: 0,
      silenceRatio: null,
      speechEnergyDb: null,
      ambienceEnergyDb: null,
      energyDeltaDb: null,
      silenceThresholdRms: null,
      maxRms: null,
    };
  }

  const windowSize = Math.max(128, Math.floor(sampleRate * windowSec));
  const rmsValues = [];
  for (let cursor = 0; cursor < samples.length; cursor += windowSize) {
    const end = Math.min(samples.length, cursor + windowSize);
    let sum = 0;
    for (let i = cursor; i < end; i += 1) {
      const v = samples[i];
      sum += v * v;
    }
    const len = Math.max(1, end - cursor);
    rmsValues.push(Math.sqrt(sum / len));
  }

  const maxRms = Math.max(...rmsValues, 0);
  const silenceThresholdRms = Math.max(1e-6, maxRms * 0.12);
  const silenceCount = rmsValues.filter((value) => value <= silenceThresholdRms).length;
  const silenceRatio = rmsValues.length > 0 ? silenceCount / rmsValues.length : null;

  const lowCut = percentile(rmsValues, 0.25);
  const highCut = percentile(rmsValues, 0.75);
  const lowBand = rmsValues.filter((value) => value <= lowCut);
  const highBand = rmsValues.filter((value) => value >= highCut);

  const ambienceMedian = median(lowBand);
  const speechMedian = median(highBand);

  const ambienceEnergyDb = Number.isFinite(ambienceMedian) ? toDb(ambienceMedian) : null;
  const speechEnergyDb = Number.isFinite(speechMedian) ? toDb(speechMedian) : null;
  const energyDeltaDb =
    Number.isFinite(speechEnergyDb) && Number.isFinite(ambienceEnergyDb)
      ? speechEnergyDb - ambienceEnergyDb
      : null;

  return {
    windowCount: rmsValues.length,
    silenceRatio,
    speechEnergyDb,
    ambienceEnergyDb,
    energyDeltaDb,
    silenceThresholdRms,
    maxRms,
  };
};

export const analyzeWindowedEnergyFromFile = async (filePath, sampleRate = 16_000, windowSec = 0.2) => {
  const samples = await decodeToMonoFloatSamples(filePath, sampleRate);
  return computeWindowedEnergyMetrics(samples, sampleRate, windowSec);
};

export const normalizeReason = (code, detail) => ({
  code: String(code || 'unknown').trim(),
  detail: String(detail || '').trim(),
});

export const isFiniteNumber = (value) => Number.isFinite(value);

export const round = (value, digits = 3) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
