import net from 'node:net';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];
const DEFAULT_PORT = 3000;
const CONNECTION_TIMEOUT_MS = 320;
const FETCH_TIMEOUT_MS = 900;

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const withTimeout = async (promise, timeoutMs) => {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const canConnect = (host, port) => new Promise((resolve) => {
  const socket = new net.Socket();
  let settled = false;

  const finish = (value) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(value);
  };

  socket.setTimeout(CONNECTION_TIMEOUT_MS);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
  socket.once('close', () => finish(false));
  socket.connect(port, host);
});

const inferFrontendMode = async (host, port) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`http://${host}:${port}/`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    const html = String(await response.text().catch(() => ''));
    if (/turbopack/i.test(html) || /webpack-hmr/i.test(html)) {
      return 'next-dev';
    }
    if (/\/_next\/static\/chunks\//i.test(html) || /V FLOW AI/i.test(html)) {
      return 'next-runtime';
    }
    return 'frontend-server';
  } catch {
    return 'frontend-server';
  } finally {
    clearTimeout(timer);
  }
};

const findLoopbackListener = async (port) => {
  for (const host of LOOPBACK_HOSTS) {
    const open = await canConnect(host, port);
    if (open) return host;
  }
  return '';
};

export const resolveGuardPort = (args = [], fallbackPort = DEFAULT_PORT) => {
  const localArgs = Array.isArray(args) ? args : [];
  const portFlagIndex = localArgs.findIndex((item) => String(item || '').trim() === '--port');
  if (portFlagIndex >= 0 && portFlagIndex < localArgs.length - 1) {
    return toInt(localArgs[portFlagIndex + 1], fallbackPort);
  }
  const inlinePortArg = localArgs.find((item) => String(item || '').trim().startsWith('--port='));
  if (inlinePortArg) {
    return toInt(String(inlinePortArg).split('=')[1], fallbackPort);
  }
  const envPort = process.env.PORT;
  return toInt(envPort, fallbackPort);
};

export const ensureLoopbackPortAvailable = async (mode, port, options = {}) => {
  const skipGuard = String(process.env.VF_DISABLE_FRONTEND_START_GUARD || '').trim() === '1';
  if (skipGuard) return;
  const safeMode = String(mode || 'frontend').trim();
  const safePort = toInt(port, DEFAULT_PORT);
  const existingHost = await findLoopbackListener(safePort);
  if (!existingHost) return;

  const allowSameProcess = options?.allowSameProcess === true;
  if (allowSameProcess) return;

  const existingMode = await withTimeout(inferFrontendMode(existingHost, safePort), FETCH_TIMEOUT_MS + 100).catch(() => 'frontend-server');
  throw new Error(
    `[frontend-startup-guard] Cannot start ${safeMode} on loopback port ${safePort}. `
    + `Detected ${existingMode} listening at ${existingHost}:${safePort}. `
    + 'Stop the existing frontend server or change PORT.'
  );
};
