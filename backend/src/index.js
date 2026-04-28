import { createBackendApp } from './routes.js';
import { createMockEnv, normalizeEnv } from './env.js';
import JobCoordinator from './do/JobCoordinator.js';

export const app = createBackendApp();

export async function fetch(request, env, ctx) {
  return app.fetch(request, normalizeEnv(env), ctx);
}

export async function queue(batch, env, ctx) {
  const normalizedEnv = normalizeEnv(env);
  const coordinatorNamespace = normalizedEnv.JOB_COORDINATOR;
  if (!coordinatorNamespace || typeof coordinatorNamespace.idFromName !== 'function' || typeof coordinatorNamespace.get !== 'function') {
    throw new Error('Missing JOB_COORDINATOR Durable Object binding.');
  }

  const coordinatorId = coordinatorNamespace.idFromName('default');
  const coordinator = coordinatorNamespace.get(coordinatorId);

  for (const message of batch?.messages || []) {
    const payload = message?.body && typeof message.body === 'object' && message.body.job
      ? message.body.job
      : message?.body ?? null;

    const response = await coordinator.fetch(
      new Request('http://job-coordinator/jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload ?? {}),
      })
    );

    if (!response.ok) {
      throw new Error(`JobCoordinator rejected queue message with status ${response.status}.`);
    }
  }

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(Promise.resolve());
  }
}

export const worker = app;

export default {
  fetch,
  queue,
};

export { createBackendApp, createMockEnv, normalizeEnv };
export { JobCoordinator };
