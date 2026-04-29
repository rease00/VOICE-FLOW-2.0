const bindingNames = Object.freeze({
  DB: 'DB',
  ASSETS: 'ASSETS',
  ARTIFACTS_BUCKET: 'ARTIFACTS_BUCKET',
  JOB_QUEUE: 'JOB_QUEUE',
  JOB_COORDINATOR: 'JOB_COORDINATOR',
});

/**
 * @typedef {object} D1DatabaseLike
 * @property {(query: string, params?: unknown[]) => { first?: () => Promise<unknown>; run?: () => Promise<unknown>; all?: () => Promise<unknown>; raw?: () => Promise<unknown>; bind?: (...values: unknown[]) => D1DatabaseLike; }} prepare
 *
 * @typedef {object} AssetFetcherLike
 * @property {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 *
 * @typedef {object} QueueProducerLike
 * @property {(message: unknown) => Promise<unknown>} send
 * @property {(messages: unknown[]) => Promise<unknown>} sendBatch
 *
 * @typedef {object} CoordinatorLike
 * @property {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 *
 * @typedef {object} WorkerEnv
 * @property {D1DatabaseLike | null | undefined} [DB]
 * @property {AssetFetcherLike | null | undefined} [ASSETS]
 * @property {{ put?: Function; get?: Function; delete?: Function; list?: Function; } | null | undefined} [ARTIFACTS_BUCKET]
 * @property {QueueProducerLike | null | undefined} [JOB_QUEUE]
 * @property {CoordinatorLike | null | undefined} [JOB_COORDINATOR]
 */

const isFunction = (value) => typeof value === 'function';

export const hasFetchBinding = (binding) => Boolean(binding && isFunction(binding.fetch));

export const hasQueueBinding = (binding) => Boolean(binding && isFunction(binding.send));

export const hasR2Binding = (binding) => Boolean(
  binding && (isFunction(binding.get) || isFunction(binding.put) || isFunction(binding.delete) || isFunction(binding.list))
);

export const hasDurableObjectBinding = (binding) => Boolean(
  binding && isFunction(binding.idFromName) && isFunction(binding.get)
);

export const normalizeEnv = (env = {}) => ({
  ...env,
  DB: env.DB ?? null,
  ASSETS: env.ASSETS ?? null,
  ARTIFACTS_BUCKET: env.ARTIFACTS_BUCKET ?? env.R2 ?? env.ARTIFACTS ?? env.R2_ARTIFACTS ?? null,
  JOB_QUEUE: env.JOB_QUEUE ?? null,
  JOB_COORDINATOR: env.JOB_COORDINATOR ?? null,
});

export const createMockEnv = (overrides = {}) => normalizeEnv(overrides);

export const describeEnvBindings = (env = {}) => {
  const normalized = normalizeEnv(env);

  return {
    [bindingNames.DB]: Boolean(normalized.DB),
    [bindingNames.ASSETS]: hasFetchBinding(normalized.ASSETS),
    [bindingNames.ARTIFACTS_BUCKET]: hasR2Binding(normalized.ARTIFACTS_BUCKET),
    [bindingNames.JOB_QUEUE]: hasQueueBinding(normalized.JOB_QUEUE),
    [bindingNames.JOB_COORDINATOR]: hasDurableObjectBinding(normalized.JOB_COORDINATOR),
  };
};

export { bindingNames };
