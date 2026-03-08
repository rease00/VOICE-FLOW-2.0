import path from 'path';
import { spawn } from 'node:child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const truthy = (value: unknown): boolean => {
  const token = String(value || '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const hasValue = (value: unknown): boolean => String(value || '').trim().length > 0;

const assertProductionAuthHardening = (mode: string, env: Record<string, string>): void => {
  if (mode !== 'production') return;

  const violations: string[] = [];
  if (truthy(env.VITE_ENABLE_LOCAL_ADMIN_DEV_LOGIN)) {
    violations.push('VITE_ENABLE_LOCAL_ADMIN_DEV_LOGIN must be 0 in production builds.');
  }
  if (truthy(env.VITE_ENABLE_DEV_UID_HEADER)) {
    violations.push('VITE_ENABLE_DEV_UID_HEADER must be 0 in production builds.');
  }
  if (truthy(env.VITE_DEV_SERVER_EXPOSE)) {
    violations.push('VITE_DEV_SERVER_EXPOSE must be 0 in production builds.');
  }
  if (truthy(env.VITE_ENABLE_LOCAL_BOOTSTRAP_ENDPOINT)) {
    violations.push('VITE_ENABLE_LOCAL_BOOTSTRAP_ENDPOINT must be 0 in production builds.');
  }
  if (String(env.VF_AUTH_ENFORCE || '').trim() !== '1') {
    violations.push('VF_AUTH_ENFORCE must be 1 for production.');
  }

  const localAdminSecretKeys = [
    'VITE_LOCAL_ADMIN_PASSWORD_HASH_B64',
    'VITE_LOCAL_ADMIN_PASSWORD_SALT_B64',
    'VITE_LOCAL_ADMIN_SESSION_KEY_B64',
  ];
  const localAdminSecretsConfigured = localAdminSecretKeys.filter((key) => hasValue(env[key]));
  if (localAdminSecretsConfigured.length > 0) {
    violations.push(
      `Remove local admin dev secrets from production env: ${localAdminSecretsConfigured.join(', ')}.`
    );
  }

  if (violations.length > 0) {
    throw new Error(`[security] Production build blocked due to unsafe auth env:\n- ${violations.join('\n- ')}`);
  }
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
  assertProductionAuthHardening(mode, env);
  const exposeDevServer = truthy(env.VITE_DEV_SERVER_EXPOSE);
  return {
    envDir: path.resolve(__dirname, '..'),
    server: {
      port: 3000,
      host: exposeDevServer ? '0.0.0.0' : '127.0.0.1',
      watch: {
        ignored: ['**/playwright-report/**', '**/test-results/**', '**/tmp_dir/**'],
      },
    },
    build: {
      modulePreload: false,
      rollupOptions: {
        output: {
          hoistTransitiveImports: false,
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;

            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('scheduler') || id.includes('react')) return 'vendor-react';
            if (id.includes('@firebase/auth') || id.includes('firebase/auth')) return 'vendor-firebase-auth';
            if (id.includes('@firebase/firestore') || id.includes('firebase/firestore')) return 'vendor-firebase-db';
            if (id.includes('@firebase/app') || id.includes('firebase/app')) return 'vendor-firebase-core';
            if (id.includes('firebase')) return 'vendor-firebase';
            if (id.includes('@google/genai')) return 'vendor-genai';
            if (id.includes('onnxruntime-common') || id.includes('onnxruntime') || id.includes('onnxruntime-web')) return 'vendor-ort';
            if (
              id.includes('kokoro-js')
              || id.includes('phonemizer')
              || id.includes('@huggingface')
              || id.includes('idb')
              || id.includes('p-retry')
            ) {
              return 'vendor-ml';
            }
            return 'vendor';
          },
        },
      },
    },
    plugins: [react(), localBootstrapPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
