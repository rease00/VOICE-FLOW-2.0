import {
  JOB_STATUSES,
  createJobStatus,
  mergeJobStatus,
  parseJobStatus,
} from '../jobs.js';

const STORAGE_KEYS = Object.freeze({
  jobPrefix: 'job:',
  queue: 'queue',
  lastClaimed: 'last-claimed',
});

const cleanString = (value) => String(value ?? '').trim();

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: init.status ?? 200,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    ...(init.headers ?? {}),
  },
});

const textResponse = (body, init = {}) => new Response(body, {
  status: init.status ?? 200,
  headers: {
    'content-type': 'text/plain; charset=utf-8',
    ...(init.headers ?? {}),
  },
});

const readJson = async (request) => {
  const raw = await request.text();
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.message = `Invalid JSON payload: ${error.message}`;
    throw error;
  }
};

const now = () => Date.now();

export class JobCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/health' && method === 'GET') {
        return jsonResponse({
          ok: true,
          name: 'JobCoordinator',
          queued: await this.countQueuedJobs(),
        });
      }

      if (path === '/jobs' && method === 'POST') {
        const payload = await readJson(request);
        const job = await this.enqueueJob(payload);
        return jsonResponse({ ok: true, job }, { status: 202 });
      }

      if (path === '/jobs/next' && method === 'POST') {
        const job = await this.claimNextJob();
        if (!job) {
          return jsonResponse({ ok: true, job: null }, { status: 204 });
        }
        return jsonResponse({ ok: true, job });
      }

      const jobMatch = path.match(/^\/jobs\/([^/]+)(?:\/(status|claim|cancel))?$/);
      if (jobMatch) {
        const jobId = decodeURIComponent(jobMatch[1]);
        const action = jobMatch[2] || null;

        if (method === 'GET' && !action) {
          const job = await this.getJob(jobId);
          if (!job) {
            return jsonResponse({ ok: false, error: 'Job not found.' }, { status: 404 });
          }
          return jsonResponse({ ok: true, job });
        }

        if (method === 'PATCH' && action === 'status') {
          const payload = await readJson(request);
          const job = await this.updateJobStatus(jobId, payload);
          if (!job) {
            return jsonResponse({ ok: false, error: 'Job not found.' }, { status: 404 });
          }
          return jsonResponse({ ok: true, job });
        }

        if (method === 'POST' && action === 'claim') {
          const job = await this.claimJob(jobId);
          if (!job) {
            return jsonResponse({ ok: false, error: 'Job not found.' }, { status: 404 });
          }
          return jsonResponse({ ok: true, job });
        }

        if (method === 'POST' && action === 'cancel') {
          const job = await this.cancelJob(jobId);
          if (!job) {
            return jsonResponse({ ok: false, error: 'Job not found.' }, { status: 404 });
          }
          return jsonResponse({ ok: true, job });
        }
      }

      return textResponse('Not found', { status: 404 });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  }

  async countQueuedJobs() {
    const queue = await this.readQueue();
    return queue.length;
  }

  async readQueue() {
    const queue = await this.state.storage.get(STORAGE_KEYS.queue);
    return Array.isArray(queue) ? queue : [];
  }

  async writeQueue(queue) {
    await this.state.storage.put(STORAGE_KEYS.queue, queue);
  }

  async enqueueJob(input = {}) {
    const job = createJobStatus({
      ...input,
      status: JOB_STATUSES.queued,
      submittedAtMs: input.submittedAtMs ?? now(),
      createdAtMs: input.createdAtMs ?? now(),
      updatedAtMs: input.updatedAtMs ?? now(),
    });

    const existing = await this.getJob(job.jobId);
    if (existing) {
      return mergeJobStatus(existing, job);
    }

    await this.state.storage.put(`${STORAGE_KEYS.jobPrefix}${job.jobId}`, job);
    const queue = await this.readQueue();
    if (!queue.includes(job.jobId)) {
      queue.push(job.jobId);
      await this.writeQueue(queue);
    }

    return job;
  }

  async getJob(jobId) {
    const id = cleanString(jobId);
    if (!id) return null;
    const record = await this.state.storage.get(`${STORAGE_KEYS.jobPrefix}${id}`);
    return parseJobStatus(record);
  }

  async saveJob(job) {
    const normalized = createJobStatus(job);
    await this.state.storage.put(`${STORAGE_KEYS.jobPrefix}${normalized.jobId}`, normalized);
    return normalized;
  }

  async updateJobStatus(jobId, patch = {}) {
    const current = await this.getJob(jobId);
    if (!current) return null;
    const updated = mergeJobStatus(current, {
      ...patch,
      jobId: current.jobId,
      updatedAtMs: patch.updatedAtMs ?? now(),
    });
    await this.saveJob(updated);
    return updated;
  }

  async claimJob(jobId) {
    const current = await this.getJob(jobId);
    if (!current) return null;

    const claimed = mergeJobStatus(current, {
      status: JOB_STATUSES.claimed,
      claimedAtMs: current.claimedAtMs ?? now(),
      updatedAtMs: now(),
    });

    await this.saveJob(claimed);
    await this.rememberLastClaimed(claimed.jobId);
    await this.removeFromQueue(claimed.jobId);
    return claimed;
  }

  async cancelJob(jobId) {
    const current = await this.getJob(jobId);
    if (!current) return null;

    const canceled = mergeJobStatus(current, {
      status: JOB_STATUSES.canceled,
      finishedAtMs: now(),
      updatedAtMs: now(),
    });

    await this.saveJob(canceled);
    await this.removeFromQueue(canceled.jobId);
    return canceled;
  }

  async claimNextJob() {
    const queue = await this.readQueue();
    if (queue.length === 0) {
      return null;
    }

    const jobId = queue.shift();
    await this.writeQueue(queue);
    const current = await this.getJob(jobId);
    if (!current) {
      return null;
    }

    const claimed = mergeJobStatus(current, {
      status: JOB_STATUSES.claimed,
      claimedAtMs: current.claimedAtMs ?? now(),
      updatedAtMs: now(),
    });
    await this.saveJob(claimed);
    await this.rememberLastClaimed(claimed.jobId);
    return claimed;
  }

  async removeFromQueue(jobId) {
    const queue = await this.readQueue();
    const nextQueue = queue.filter((value) => value !== jobId);
    if (nextQueue.length !== queue.length) {
      await this.writeQueue(nextQueue);
    }
  }

  async rememberLastClaimed(jobId) {
    await this.state.storage.put(STORAGE_KEYS.lastClaimed, {
      jobId,
      updatedAtMs: now(),
    });
  }
}

export default JobCoordinator;

