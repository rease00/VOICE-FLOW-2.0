const DEFAULT_QUEUE_BINDING_NAMES = Object.freeze([
  'JOB_QUEUE',
  'JOBS_QUEUE',
  'QUEUE',
]);

export const JOB_ENV_KEYS = Object.freeze({
  queueBinding: 'VF_JOB_QUEUE_BINDING',
});

export const JOB_STATUSES = Object.freeze({
  queued: 'queued',
  claimed: 'claimed',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'canceled',
});

export const JOB_KINDS = Object.freeze({
  tts: 'tts',
  artifact: 'artifact',
  generic: 'generic',
});

const cleanString = (value) => String(value ?? '').trim();

const randomId = (prefix = 'job') => {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${suffix}`;
};

export const isTerminalJobStatus = (status) => {
  const normalized = cleanString(status).toLowerCase();
  return (
    normalized === JOB_STATUSES.succeeded ||
    normalized === JOB_STATUSES.failed ||
    normalized === JOB_STATUSES.canceled
  );
};

export const normalizeJobId = (value) => {
  const id = cleanString(value);
  if (!id) {
    return randomId('job');
  }
  return id;
};

export const normalizeJobKind = (value) => {
  const kind = cleanString(value).toLowerCase();
  return kind || JOB_KINDS.generic;
};

export const normalizeJobStatus = (value) => {
  const status = cleanString(value).toLowerCase();
  return JOB_STATUSES[status] ? status : JOB_STATUSES.queued;
};

export const createJobSubmission = (input = {}) => {
  const nowMs = input.submittedAtMs ?? Date.now();
  const jobId = normalizeJobId(input.jobId);
  const kind = normalizeJobKind(input.kind);
  const status = normalizeJobStatus(input.status ?? JOB_STATUSES.queued);

  return {
    jobId,
    kind,
    status,
    requestId: cleanString(input.requestId) || null,
    idempotencyKey: cleanString(input.idempotencyKey) || null,
    queueName: cleanString(input.queueName) || null,
    payload: input.payload ?? {},
    metadata: input.metadata ?? {},
    priority: cleanString(input.priority) || 'normal',
    submittedAtMs: nowMs,
    createdAtMs: input.createdAtMs ?? nowMs,
    updatedAtMs: input.updatedAtMs ?? nowMs,
    claimedAtMs: input.claimedAtMs ?? null,
    startedAtMs: input.startedAtMs ?? null,
    finishedAtMs: input.finishedAtMs ?? null,
    retryCount: Number.isFinite(input.retryCount) ? input.retryCount : 0,
    attempts: Number.isFinite(input.attempts) ? input.attempts : 0,
  };
};

export const createJobStatus = (input = {}) => {
  const nowMs = input.updatedAtMs ?? Date.now();
  const submission = createJobSubmission({
    ...input,
    submittedAtMs: input.submittedAtMs ?? nowMs,
  });

  return {
    ...submission,
    status: normalizeJobStatus(input.status ?? submission.status),
    progress: Number.isFinite(input.progress) ? input.progress : 0,
    step: cleanString(input.step) || null,
    message: cleanString(input.message) || null,
    result: input.result ?? null,
    error: input.error ?? null,
    artifactKey: cleanString(input.artifactKey) || null,
    output: input.output ?? null,
    outputUrl: cleanString(input.outputUrl) || null,
    updatedAtMs: nowMs,
    finishedAtMs: input.finishedAtMs ?? (isTerminalJobStatus(input.status ?? submission.status) ? nowMs : null),
  };
};

export const mergeJobStatus = (current, patch = {}) => {
  const base = createJobStatus(current ?? {});
  const merged = {
    ...base,
    ...patch,
    payload: patch.payload ?? base.payload,
    metadata: patch.metadata ?? base.metadata,
    result: patch.result ?? base.result,
    error: patch.error ?? base.error,
    output: patch.output ?? base.output,
  };

  merged.status = normalizeJobStatus(merged.status);
  merged.updatedAtMs = patch.updatedAtMs ?? Date.now();
  if (patch.createdAtMs != null) {
    merged.createdAtMs = patch.createdAtMs;
  }
  if (isTerminalJobStatus(merged.status) && merged.finishedAtMs == null) {
    merged.finishedAtMs = merged.updatedAtMs;
  }

  return merged;
};

export const serializeJobStatus = (status) => JSON.stringify(createJobStatus(status));

export const parseJobStatus = (value) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'object') {
    return createJobStatus(value);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return createJobStatus(JSON.parse(value));
  } catch {
    return null;
  }
};

export const resolveQueueBindingName = (env = {}, options = {}) => {
  const preferred = cleanString(options.bindingName || env?.[JOB_ENV_KEYS.queueBinding]);
  const candidateNames = [
    preferred,
    ...DEFAULT_QUEUE_BINDING_NAMES,
  ].filter(Boolean);

  for (const name of candidateNames) {
    if (env && env[name]) {
      return name;
    }
  }

  return null;
};

export const resolveQueueBinding = (env = {}, options = {}) => {
  const bindingName = resolveQueueBindingName(env, options);
  if (!bindingName) {
    return null;
  }
  return env[bindingName] ?? null;
};

export const requireQueueBinding = (env = {}, options = {}) => {
  const queue = resolveQueueBinding(env, options);
  if (!queue) {
    throw new Error(
      `Missing Cloudflare queue binding. Set one of: ${[
        options.bindingName,
        env?.[JOB_ENV_KEYS.queueBinding],
        ...DEFAULT_QUEUE_BINDING_NAMES,
      ].filter(Boolean).join(', ')}.`
    );
  }
  return queue;
};

export const createJobQueueMessage = (input = {}) => ({
  type: 'job.submit',
  job: createJobSubmission(input.job ?? input),
  submittedAtMs: input.submittedAtMs ?? Date.now(),
  metadata: input.metadata ?? {},
});

export const submitJob = async (env, input = {}, options = {}) => {
  const queue = requireQueueBinding(env, options);
  const message = createJobQueueMessage(input);

  if (typeof queue.send !== 'function') {
    throw new Error('The configured queue binding does not expose a send() method.');
  }

  await queue.send(message);

  return {
    ...message.job,
    queueName: message.job.queueName || options.queueName || null,
    enqueued: true,
    queueMessageType: message.type,
  };
};

export const buildJobStatusResponse = (input = {}) => {
  const status = createJobStatus(input);
  return {
    ok: true,
    job: status,
    terminal: isTerminalJobStatus(status.status),
  };
};

