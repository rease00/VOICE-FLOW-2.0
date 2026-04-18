import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

import { streamAudioNovelLive } from '../src/server/audioNovel/service.ts';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { applyRuntimeEnv } from './load-runtime-env.mjs';

const AUDIO_NOVEL_WS_PATH = '/api/v1/library/audio-novel/ws';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
applyRuntimeEnv(rootDir);
const { default: next } = await import('next');
const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || process.env.NEXT_PORT || 3000);
const hostname = String(process.env.HOSTNAME || '0.0.0.0').trim() || '0.0.0.0';

const nextApp = next({ dev, dir: rootDir, hostname, port });
const handle = nextApp.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });
let handleUpgrade: ReturnType<typeof nextApp.getUpgradeHandler> | null = null;

type AudioNovelSocketMessage = {
  type?: string;
  text?: string;
  bookId?: string;
  chapterId?: string;
  guestSessionId?: string;
  bookSource?: string;
};

const sendJson = (socket: import('ws').WebSocket, payload: Record<string, unknown>) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const rejectUpgrade = (socket: import('node:net').Socket, statusCode: number, statusText: string) => {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json; charset=utf-8\r\n' +
      'Cache-Control: no-store\r\n' +
      '\r\n' +
      JSON.stringify({ error: statusText })
  );
  socket.destroy();
};

const normalizeGuestSessionId = (value: string | undefined): string => {
  const safeValue = String(value || '').trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
  if (!safeValue) {
    return '';
  }
  return safeValue.startsWith('guest-') ? safeValue : `guest-${safeValue}`;
};

wss.on('connection', (socket, _request, user) => {
  const decodedUser = user as DecodedIdToken | undefined;
  const uid = String(decodedUser?.uid || '').trim();
  console.log('[audio-novel-ws] connection', { uid: uid || null });
  let active = false;
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }, 30_000);

  socket.on('message', async (payload) => {
    try {
      console.log('[audio-novel-ws] message', { bytes: Buffer.byteLength(String(payload || '')) });
      let message: AudioNovelSocketMessage | null = null;
      try {
        message = JSON.parse(String(payload || '')) as AudioNovelSocketMessage;
      } catch {
        sendJson(socket, { error: 'Invalid audio novel WebSocket payload.', code: 'BAD_REQUEST' });
        return;
      }

      if (message?.type === 'pong') {
        return;
      }
      if (message?.type !== 'stdio' && message?.type !== 'book') {
        sendJson(socket, { error: 'Unsupported audio novel WebSocket action.', code: 'BAD_REQUEST' });
        return;
      }
      if (active) {
        sendJson(socket, { error: 'Already generating', code: 'BUSY' });
        return;
      }

      const text = String(message.text || '').trim();
      if (!text) {
        sendJson(socket, { error: 'Text is required.', code: 'EMPTY' });
        return;
      }

      const sessionKey = uid || normalizeGuestSessionId(message.guestSessionId);
      if (!sessionKey) {
        sendJson(socket, { error: 'Authentication or guest session is required.', code: 'UNAUTHORIZED' });
        return;
      }

      active = true;
      sendJson(socket, { status: 'bridge-ready' });
      await streamAudioNovelLive(
        sessionKey,
        text,
        String(message.bookId || '').trim() || undefined,
        String(message.bookSource || '').trim() || undefined,
        (chunk) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (Buffer.isBuffer(chunk)) {
          console.log('[audio-novel-ws] send-binary', { bytes: chunk.length });
          socket.send(chunk, { binary: true });
          return;
        }
        console.log('[audio-novel-ws] send-json', chunk);
        socket.send(JSON.stringify(chunk));
      });
    } catch (error) {
      console.error('[audio-novel-ws] Live playback failed.', error);
      sendJson(socket, {
        error: error instanceof Error ? error.message : 'Live playback failed.',
        code: 'LIVE_FAILED',
      });
    } finally {
      active = false;
    }
  });

  socket.on('close', (code, reason) => {
    console.log('[audio-novel-ws] close', { code, reason: String(reason || '') });
    clearInterval(heartbeat);
  });
  socket.on('error', (error) => {
    console.error('[audio-novel-ws] Socket error.', error);
    clearInterval(heartbeat);
  });
});

await nextApp.prepare();
handleUpgrade = nextApp.getUpgradeHandler();

const server = http.createServer((request, response) => {
  const parsed = parse(request.url || '/', true);
  handle(request, response, parsed).catch((error) => {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : 'Internal server error');
  });
});

server.on('upgrade', (request, socket, head) => {
  void (async () => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
      if (url.pathname === AUDIO_NOVEL_WS_PATH) {
        console.log('[audio-novel-ws] upgrade', { pathname: url.pathname });
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request, undefined);
        });
        return;
      }
      handleUpgrade?.(request, socket, head);
    } catch {
      socket.destroy();
    }
  })();
});

server.listen(port, hostname, () => {
  console.log(`[next-audio-server] listening on http://${hostname}:${port} (${dev ? 'dev' : 'prod'})`);
});
