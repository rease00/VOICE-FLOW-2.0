const DEFAULT_ARTIFACT_BINDING_NAMES = Object.freeze([
  'R2',
  'ARTIFACTS',
  'ARTIFACTS_BUCKET',
  'R2_ARTIFACTS',
]);

export const STORAGE_ENV_KEYS = Object.freeze({
  backend: 'VF_READER_STORAGE_BACKEND',
  publicBaseUrl: 'VF_READER_STORAGE_PUBLIC_BASE_URL',
  bucketBinding: 'VF_READER_STORAGE_BUCKET_BINDING',
});

export const STORAGE_BACKENDS = Object.freeze({
  r2: 'r2',
});

const cleanString = (value) => String(value ?? '').trim();

const randomId = (prefix = 'artifact') => {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${suffix}`;
};

export const normalizeArtifactKey = (value) => {
  const key = cleanString(value).replace(/^\/+/, '').replace(/\\+/g, '/');
  if (!key) {
    throw new Error('Artifact key is required.');
  }
  if (key.includes('..')) {
    throw new Error('Artifact key must not contain path traversal segments.');
  }
  return key.replace(/\/{2,}/g, '/');
};

export const buildArtifactKey = ({
  namespace = 'tts',
  jobId = '',
  artifactId = '',
  filename = '',
} = {}) => {
  const parts = [
    cleanString(namespace) || 'tts',
    cleanString(jobId),
    cleanString(artifactId),
    cleanString(filename),
  ].filter(Boolean);

  if (parts.length === 0) {
    parts.push(randomId('artifact'));
  }

  return normalizeArtifactKey(parts.join('/'));
};

export const resolveArtifactBucketBindingName = (env = {}, options = {}) => {
  const preferred = cleanString(options.bindingName || env?.[STORAGE_ENV_KEYS.bucketBinding]);
  const candidateNames = [
    preferred,
    ...DEFAULT_ARTIFACT_BINDING_NAMES,
  ].filter(Boolean);

  for (const name of candidateNames) {
    if (env && env[name]) {
      return name;
    }
  }

  return null;
};

export const resolveArtifactBucket = (env = {}, options = {}) => {
  const bindingName = resolveArtifactBucketBindingName(env, options);
  if (!bindingName) {
    return null;
  }
  return env[bindingName] ?? null;
};

export const requireArtifactBucket = (env = {}, options = {}) => {
  const bucket = resolveArtifactBucket(env, options);
  if (!bucket) {
    const names = [
      options.bindingName,
      env?.[STORAGE_ENV_KEYS.bucketBinding],
      ...DEFAULT_ARTIFACT_BINDING_NAMES,
    ].filter(Boolean);
    throw new Error(
      `Missing R2 artifact binding. Set one of: ${[...new Set(names)].join(', ')}.`
    );
  }
  return bucket;
};

export const createArtifactDescriptor = (input = {}) => {
  const key = normalizeArtifactKey(input.key);
  const nowMs = input.uploadedAtMs ?? Date.now();

  return {
    key,
    contentType: input.contentType ?? null,
    customMetadata: input.customMetadata ?? null,
    uploadedAtMs: nowMs,
    etag: input.etag ?? null,
    size: input.size ?? null,
    checksum: input.checksum ?? null,
    namespace: cleanString(input.namespace) || null,
    jobId: cleanString(input.jobId) || null,
    artifactId: cleanString(input.artifactId) || null,
    filename: cleanString(input.filename) || null,
  };
};

export const resolveArtifactPublicUrl = (env = {}, key, options = {}) => {
  const baseUrl = cleanString(options.publicBaseUrl || env?.[STORAGE_ENV_KEYS.publicBaseUrl]);
  if (!baseUrl) {
    return null;
  }

  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${normalizeArtifactKey(key)}`;
  return url.toString();
};

export const putArtifact = async (env, key, body, options = {}) => {
  const bucket = requireArtifactBucket(env, options);
  const normalizedKey = normalizeArtifactKey(key);

  const stored = await bucket.put(normalizedKey, body, {
    httpMetadata: options.httpMetadata ?? undefined,
    customMetadata: options.customMetadata ?? undefined,
    onlyIf: options.onlyIf ?? undefined,
  });

  return createArtifactDescriptor({
    key: normalizedKey,
    contentType: options.contentType ?? options.httpMetadata?.contentType ?? null,
    customMetadata: options.customMetadata ?? null,
    uploadedAtMs: stored?.uploaded ? new Date(stored.uploaded).getTime() : Date.now(),
    etag: stored?.etag ?? stored?.httpEtag ?? null,
    size: stored?.size ?? options.size ?? null,
    checksum: options.checksum ?? null,
    namespace: options.namespace,
    jobId: options.jobId,
    artifactId: options.artifactId,
    filename: options.filename,
  });
};

export const getArtifact = async (env, key, options = {}) => {
  const bucket = requireArtifactBucket(env, options);
  const normalizedKey = normalizeArtifactKey(key);
  const object = await bucket.get(normalizedKey, options.getOptions ?? undefined);
  if (!object) {
    return null;
  }

  return {
    key: normalizedKey,
    body: object.body ?? null,
    size: object.size ?? null,
    uploaded: object.uploaded ?? null,
    etag: object.etag ?? object.httpEtag ?? null,
    httpMetadata: object.httpMetadata ?? null,
    customMetadata: object.customMetadata ?? null,
    bodyUsed: Boolean(object.bodyUsed),
    object,
    publicUrl: resolveArtifactPublicUrl(env, normalizedKey, options),
  };
};

export const deleteArtifact = async (env, key, options = {}) => {
  const bucket = requireArtifactBucket(env, options);
  const normalizedKey = normalizeArtifactKey(key);
  await bucket.delete(normalizedKey);
  return { key: normalizedKey, deleted: true };
};

export const listArtifacts = async (env, options = {}) => {
  const bucket = requireArtifactBucket(env, options);
  const result = await bucket.list({
    prefix: cleanString(options.prefix) || undefined,
    limit: options.limit ?? undefined,
    cursor: options.cursor ?? undefined,
  });

  return {
    keys: result?.objects ?? [],
    truncated: Boolean(result?.truncated),
    cursor: result?.cursor ?? null,
    delimitedPrefixes: result?.delimitedPrefixes ?? [],
  };
};

