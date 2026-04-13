import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { parse } from 'node:url';
import { WebSocketServer } from 'ws';

import { streamAudioNovelLive } from '../src/server/audioNovel/service.ts';

const AUDIO_NOVEL_WS_PATH = '/api/v1/library/audio-novel/ws';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || process.env.NEXT_PORT || 3000);
const hostname = String(process.env.HOSTNAME || '0.0.0.0').trim() || '0.0.0.0';

const nextApp = next({ dev, dir: rootDir, hostname, port });
const handle = nextApp.getRequestHandler();
const wss = new WebSocketServer({ noServer: true });

type AudioNovelSocketMessage = {
  type?: string;
  text?: string;
  bookId?: string;
  chapterId?: string;
};

const sendJson = (socket: import('ws').WebSocket, payload: Record<string, unknown>) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

wss.on('connection', (socket) => {
  let active = false;
  const heartbeat = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      socket.ping();
    }
  }, 30_000);

  socket.on('message', async (payload) => {
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

    active = true;
    try {
      await streamAudioNovelLive(text, String(message.bookId || '').trim() || undefined, (chunk) => {
        if (socket.readyState !== socket.OPEN) return;
        if (Buffer.isBuffer(chunk)) {
          socket.send(chunk, { binary: true });
          return;
        }
        socket.send(JSON.stringify(chunk));
      });
    } catch (error) {
      sendJson(socket, {
        error: error instanceof Error ? error.message : 'Live playback failed.',
        code: 'LIVE_FAILED',
      });
    } finally {
      active = false;
    }
  });

  socket.on('close', () => clearInterval(heartbeat));
  socket.on('error', () => clearInterval(heartbeat));
});

await nextApp.prepare();

const server = http.createServer((request, response) => {
  const parsed = parse(request.url || '/', true);
  handle(request, response, parsed).catch((error) => {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : 'Internal server error');
  });
});

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (url.pathname !== AUDIO_NOVEL_WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } catch {
    socket.destroy();
  }
});

server.listen(port, hostname, () => {
  console.log(`[next-audio-server] listening on http://${hostname}:${port} (${dev ? 'dev' : 'prod'})`);
});
