export const TTS_ENV_KEYS = Object.freeze({
  brokerUrl: 'VF_TTS_BROKER_URL',
  brokerApiKey: 'VF_TTS_BROKER_API_KEY',
  timeoutMs: 'VF_TTS_BROKER_TIMEOUT_MS',
  defaultEngine: 'VF_TTS_DEFAULT_ENGINE',
  callbackBaseUrl: 'VF_TTS_CALLBACK_BASE_URL',
  provider: 'VF_TTS_PROVIDER',
  openAiBaseUrl: 'VF_TTS_OPENAI_BASE_URL',
  openAiApiKey: 'VF_TTS_OPENAI_API_KEY',
  openAiModel: 'VF_TTS_OPENAI_MODEL',
  openAiVoice: 'VF_TTS_OPENAI_VOICE',
});

export const TTS_STATUSES = Object.freeze({
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'canceled',
});

const cleanString = (value) => String(value ?? '').trim();

const randomId = (prefix = 'tts') => {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${suffix}`;
};

const coerceNumber = (value, fallback = null) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const coerceObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
};

export const normalizeTtsStatus = (value) => {
  const status = cleanString(value).toLowerCase();
  return TTS_STATUSES[status] ? status : TTS_STATUSES.queued;
};

export const createTtsRequest = (input = {}) => {
  const nowMs = input.requestedAtMs ?? Date.now();
  return {
    requestId: cleanString(input.requestId) || randomId('ttsreq'),
    jobId: cleanString(input.jobId) || null,
    text: cleanString(input.text),
    voiceId: cleanString(input.voiceId) || null,
    engine: cleanString(input.engine) || null,
    language: cleanString(input.language) || null,
    format: cleanString(input.format) || 'mp3',
    speed: coerceNumber(input.speed, null),
    pitch: cleanString(input.pitch) || null,
    style: cleanString(input.style) || null,
    sampleRateHz: coerceNumber(input.sampleRateHz, null),
    volume: coerceNumber(input.volume, null),
    metadata: coerceObject(input.metadata, {}),
    callbackUrl: cleanString(input.callbackUrl) || null,
    requestedAtMs: nowMs,
  };
};

export const createTtsResponse = (input = {}) => {
  const nowMs = input.updatedAtMs ?? Date.now();
  return {
    requestId: cleanString(input.requestId) || randomId('ttsresp'),
    jobId: cleanString(input.jobId) || null,
    providerRequestId: cleanString(input.providerRequestId) || null,
    status: normalizeTtsStatus(input.status),
    audioUrl: cleanString(input.audioUrl) || null,
    artifactKey: cleanString(input.artifactKey) || null,
    contentType: cleanString(input.contentType) || null,
    mimeType: cleanString(input.mimeType) || null,
    durationMs: coerceNumber(input.durationMs, null),
    error: input.error ?? null,
    metadata: coerceObject(input.metadata, {}),
    createdAtMs: input.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
    completedAtMs: input.completedAtMs ?? (normalizeTtsStatus(input.status) === TTS_STATUSES.succeeded ? nowMs : null),
  };
};

export const normalizeTtsRequest = (value) => {
  if (typeof value === 'string') {
    return createTtsRequest({ text: value });
  }
  return createTtsRequest(value ?? {});
};

export const normalizeTtsResponse = (value) => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return createTtsResponse(JSON.parse(value));
    } catch {
      return createTtsResponse({ error: value, status: TTS_STATUSES.failed });
    }
  }
  return createTtsResponse(value);
};

export const resolveTtsBrokerConfig = (env = {}, options = {}) => {
  const brokerUrl = cleanString(options.brokerUrl || env?.[TTS_ENV_KEYS.brokerUrl]);
  const timeoutMs = coerceNumber(options.timeoutMs ?? env?.[TTS_ENV_KEYS.timeoutMs], 30000);
  const apiKey = cleanString(options.apiKey || env?.[TTS_ENV_KEYS.brokerApiKey]);
  const defaultEngine = cleanString(options.defaultEngine || env?.[TTS_ENV_KEYS.defaultEngine]) || null;
  const callbackBaseUrl = cleanString(options.callbackBaseUrl || env?.[TTS_ENV_KEYS.callbackBaseUrl]) || null;

  return {
    brokerUrl,
    timeoutMs,
    apiKey,
    defaultEngine,
    callbackBaseUrl,
  };
};

export const resolveOpenAiTtsConfig = (env = {}, options = {}) => {
  const baseUrl = cleanString(options.baseUrl || env?.[TTS_ENV_KEYS.openAiBaseUrl]);
  const apiKey = cleanString(options.apiKey || env?.[TTS_ENV_KEYS.openAiApiKey]);
  const model = cleanString(options.model || env?.[TTS_ENV_KEYS.openAiModel] || env?.[TTS_ENV_KEYS.defaultEngine]);
  const voice = cleanString(options.voice || env?.[TTS_ENV_KEYS.openAiVoice]) || 'None';
  const timeoutMs = coerceNumber(options.timeoutMs ?? env?.[TTS_ENV_KEYS.timeoutMs], 30000);

  return {
    baseUrl,
    apiKey,
    model,
    voice,
    timeoutMs,
    enabled: Boolean(baseUrl && apiKey && model),
  };
};

export const requireTtsBrokerConfig = (env = {}, options = {}) => {
  const config = resolveTtsBrokerConfig(env, options);
  if (!config.brokerUrl) {
    throw new Error(`Missing external TTS broker URL. Set ${TTS_ENV_KEYS.brokerUrl}.`);
  }
  return config;
};

const brokerFetch = async (fetchImpl, url, init, timeoutMs) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller ? controller.signal : init?.signal,
    });
    return response;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const readErrorText = async (response) => {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
};

export const createTtsBrokerClient = (env = {}, options = {}) => {
  const config = requireTtsBrokerConfig(env, options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to talk to the external TTS broker.');
  }

  const endpoint = (path) => {
    const url = new URL(config.brokerUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
    return url.toString();
  };

  const request = async (method, path, body, extra = {}) => {
    const { headers: extraHeadersInput, ...requestInit } = extra || {};
    const extraHeaders = extraHeadersInput && typeof extraHeadersInput === 'object' ? extraHeadersInput : {};
    const response = await brokerFetch(
      fetchImpl,
      endpoint(path),
      {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          ...extraHeaders,
        },
        body: body == null ? undefined : JSON.stringify(body),
        ...requestInit,
      },
      config.timeoutMs
    );

    if (!response.ok) {
      const message = await readErrorText(response);
      const error = new Error(message || `TTS broker request failed with status ${response.status}.`);
      error.status = response.status;
      error.body = message || null;
      throw error;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  };

  return {
    config,
    submit: (ttsRequest, extra = {}) => request('POST', 'requests', normalizeTtsRequest(ttsRequest), extra),
    status: (requestId, extra = {}) => request('GET', `requests/${encodeURIComponent(cleanString(requestId))}`, null, extra),
    cancel: (requestId, extra = {}) => request('POST', `requests/${encodeURIComponent(cleanString(requestId))}/cancel`, null, extra),
    request,
  };
};

export const synthesizeOpenAiSpeech = async (env = {}, ttsRequest, options = {}) => {
  const request = normalizeTtsRequest(ttsRequest);
  const config = resolveOpenAiTtsConfig(env, options);
  if (!config.enabled) {
    throw new Error(`Missing OpenAI-compatible TTS config. Set ${TTS_ENV_KEYS.openAiBaseUrl}, ${TTS_ENV_KEYS.openAiApiKey}, and ${TTS_ENV_KEYS.openAiModel}.`);
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to talk to the external TTS provider.');
  }

  const url = new URL(config.baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/audio/speech`;
  const format = cleanString(request.format) || 'mp3';
  const response = await brokerFetch(
    fetchImpl,
    url.toString(),
    {
      method: 'POST',
      headers: {
        accept: format === 'mp3' ? 'audio/mpeg' : '*/*',
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.engine || config.model,
        voice: request.voiceId || config.voice,
        input: request.text,
        response_format: format,
        ...(request.speed ? { speed: request.speed } : {}),
      }),
    },
    config.timeoutMs
  );

  if (!response.ok) {
    const message = await readErrorText(response);
    const error = new Error(message || `OpenAI-compatible TTS request failed with status ${response.status}.`);
    error.status = response.status;
    error.body = message || null;
    throw error;
  }

  const audioBytes = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || (format === 'mp3' ? 'audio/mpeg' : 'application/octet-stream');
  return {
    ...createTtsResponse({
      requestId: request.requestId,
      jobId: request.jobId,
      providerRequestId: response.headers.get('x-request-id') || null,
      status: TTS_STATUSES.succeeded,
      contentType,
      mimeType: contentType,
      metadata: {
        ...(request.metadata || {}),
        provider: 'openai-compatible',
        model: request.engine || config.model,
        voice: request.voiceId || config.voice,
      },
    }),
    audioBytes,
  };
};

export const submitTtsRequest = async (env, ttsRequest, options = {}) => {
  const client = createTtsBrokerClient(env, options);
  return normalizeTtsResponse(await client.submit(ttsRequest, options));
};

export const fetchTtsRequestStatus = async (env, requestId, options = {}) => {
  const client = createTtsBrokerClient(env, options);
  return normalizeTtsResponse(await client.status(requestId, options));
};

export const cancelTtsRequest = async (env, requestId, options = {}) => {
  const client = createTtsBrokerClient(env, options);
  return normalizeTtsResponse(await client.cancel(requestId, options));
};

export const buildTtsCallbackPayload = (input = {}) => ({
  requestId: cleanString(input.requestId) || randomId('ttswebhook'),
  jobId: cleanString(input.jobId) || null,
  status: normalizeTtsStatus(input.status),
  response: createTtsResponse(input.response ?? input),
  receivedAtMs: input.receivedAtMs ?? Date.now(),
  metadata: coerceObject(input.metadata, {}),
});
