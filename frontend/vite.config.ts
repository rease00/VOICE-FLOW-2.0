import path from 'path';
import { spawn } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const localBootstrapPlugin = () => ({
  name: 'local-bootstrap-services',
  configureServer(server: any) {
    server.middlewares.use('/__local/bootstrap-services', (req: any, res: any, next: any) => {
      if (req.method !== 'POST') {
        next();
        return;
      }

      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      try {
        const child = spawn(npmCmd, ['run', 'services:bootstrap'], {
          cwd: process.cwd(),
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, started: true, message: 'Service bootstrap started.' }));
      } catch (error: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, started: false, message: error?.message || 'Failed to start service bootstrap.' }));
      }
    });
  },
});

export default defineConfig(() => {
    return {
      envDir: path.resolve(__dirname, '..'),
      server: {
        port: 3000,
        host: '0.0.0.0',
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
      plugins: [react(), localBootstrapPlugin()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
