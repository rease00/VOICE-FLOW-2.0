import { spawn } from 'node:child_process';

const needsCmdQuote = /[\s"&|<>^()]/;

const quoteCmdArg = (value) => {
  const raw = String(value ?? '');
  if (!raw) return '""';
  if (!needsCmdQuote.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
};

const buildDisplayCommand = (command, args = []) => `${command} ${args.map((part) => quoteCmdArg(part)).join(' ')}`.trim();

export const runCommand = (command, args = [], options = {}) => {
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };
  const stdio = options.stdio || 'inherit';
  const displayCommand = buildDisplayCommand(command, args);

  return new Promise((resolve) => {
    const startedMs = Date.now();
    const finalize = (payload) => {
      resolve({
        command: displayCommand,
        elapsedMs: Date.now() - startedMs,
        ...payload,
      });
    };

    let child;
    if (process.platform === 'win32') {
      const cmdLine = [quoteCmdArg(command), ...args.map((item) => quoteCmdArg(item))].join(' ');
      child = spawn('cmd.exe', ['/d', '/s', '/c', cmdLine], {
        cwd,
        env,
        stdio,
        shell: false,
        windowsHide: false,
      });
    } else {
      child = spawn(command, args, {
        cwd,
        env,
        stdio,
        shell: false,
      });
    }

    child.on('error', (error) => {
      finalize({
        ok: false,
        code: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('close', (code) => {
      finalize({
        ok: code === 0,
        code: code ?? 1,
        error: null,
      });
    });
  });
};

export const probeCommand = async (command, args = ['--version'], options = {}) => {
  const result = await runCommand(command, args, {
    ...options,
    stdio: options.stdio || 'inherit',
  });
  return {
    ...result,
    available: result.ok,
  };
};
