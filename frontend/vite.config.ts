import path from 'path';
import { spawn } from 'node:child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const truthy = (value: unknown): boolean => {
  const token = String(value || '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const isLoopbackHost = (value: string): boolean => {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
};

const requestIsLocalOrigin = (req: any): boolean => {
  const originHeader = String(req.headers?.origin || req.headers?.referer || '').trim();
  if (originHeader) {
    try {
      const originUrl = new URL(originHeader);
      return isLoopbackHost(originUrl.hostname);
    } catch {
      return false;
    }
  }
  const hostHeader = String(req.headers?.host || '').trim().split(':')[0] || '';
  const remoteAddress = String(req.socket?.remoteAddress || '').trim();
  const remoteIsLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  return remoteIsLoopback && isLoopbackHost(hostHeader || 'localhost');
};

const requestHasValidBootstrapToken = (req: any, expectedToken: string): boolean => {
  const tokenA = String(req.headers?.['x-bootstrap-token'] || '').trim();
  const auth = String(req.headers?.authorization || '').trim();
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return tokenA === expectedToken || bearer === expectedToken;
};

const localBootstrapPlugin = (env: Record<string, string>) => ({
  name: 'local-bootstrap-services',
  configureServer(server: any) {
    const enabled = truthy(env.VITE_ENABLE_LOCAL_BOOTSTRAP_ENDPOINT);
    if (!enabled) {
      return;
    }
    const bootstrapToken = String(env.VF_DEV_BOOTSTRAP_TOKEN || '').trim();
    server.middlewares.use('/__local/bootstrap-services', (req: any, res: any, next: any) => {
      if (req.method !== 'POST') {
        next();
        return;
      }

      if (!requestIsLocalOrigin(req)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, started: false, message: 'Local origin required.' }));
        return;
      }
      if (!bootstrapToken || !requestHasValidBootstrapToken(req, bootstrapToken)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, started: false, message: 'Bootstrap token is missing or invalid.' }));
        return;
      }

      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      try {
        spawn(npmCmd, ['run', 'services:doctor'], {
          cwd: process.cwd(),
          detached: false,
          stdio: 'inherit',
          windowsHide: false,
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, started: true, message: 'Service doctor started.' }));
      } catch (error: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, started: false, message: error?.message || 'Failed to start service doctor.' }));
      }
    });
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
    const exposeDevServer = truthy(env.VITE_DEV_SERVER_EXPOSE);
    return {
      envDir: path.resolve(__dirname, '..'),
      server: {
        port: 3000,
        host: exposeDevServer ? '0.0.0.0' : '127.0.0.1',
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return undefined;

              if (id.includes('react')) return 'vendor-react';
              if (id.includes('lucide-react')) return 'vendor-icons';
              if (id.includes('firebase')) return 'vendor-firebase';
              if (id.includes('@google/genai')) return 'vendor-genai';
              if (id.includes('kokoro-js') || id.includes('@huggingface/transformers')) return 'vendor-ml';
              return 'vendor';
            },
          },
        },
      },
      plugins: [react(), localBootstrapPlugin(env)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      }
    };
});
