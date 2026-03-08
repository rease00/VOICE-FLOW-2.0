const RUNTIME_QUOTA_MESSAGE = 'Usage limit exceeded. Please check your API keys in settings.';

const GEMINI_CAPACITY_PRESSURE_ERROR_CODES = [
  'GEMINI_KEY_POOL_OVERLOADED',
  'GEMINI_KEY_POOL_TIMEOUT',
  'GEMINI_ALLOCATOR_ACQUIRE_TIMEOUT',
  'GEMINI_ALL_KEYS_RATE_LIMITED',
];

const GEMINI_RETRYABLE_TIMEOUT_ERROR_CODES = [
  'GEMINI_UPSTREAM_REQUEST_TIMEOUT',
];

export const isKnownGeminiPoolMisconfigError = (message: string): boolean => {
  const lower = String(message || '').toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('gemini_api_key_missing') ||
    lower.includes('key pool is empty') ||
    lower.includes('configure gemini_api_keys_file') ||
    lower.includes('api key is missing')
  );
};

export const isGeminiCapacityPressureError = (message: string): boolean => {
  const lower = String(message || '').toLowerCase();
  if (!lower) return false;
  return (
    GEMINI_CAPACITY_PRESSURE_ERROR_CODES.some((code) => lower.includes(code.toLowerCase())) ||
    lower.includes('capacity_pressure') ||
    lower.includes('capacity_overload') ||
    lower.includes('gemini tts capacity is saturated') ||
    lower.includes('gemini key pool is temporarily overloaded') ||
    lower.includes('gemini key pool timed out while waiting for an available key') ||
    lower.includes(RUNTIME_QUOTA_MESSAGE.toLowerCase()) ||
    (lower.includes('availablelanes=0') && lower.includes('keypoolsize='))
  );
};

export const isGeminiRetryableTimeoutError = (message: string): boolean => {
  const lower = String(message || '').toLowerCase();
  if (!lower) return false;
  return (
    GEMINI_RETRYABLE_TIMEOUT_ERROR_CODES.some((code) => lower.includes(code.toLowerCase())) ||
    lower.includes('gemini upstream request timed out') ||
    lower.includes('upstream request timeout')
  );
};

export const shouldFailFastOnGeminiRuntimeError = (message: string): boolean => {
  return isKnownGeminiPoolMisconfigError(message) || isGeminiCapacityPressureError(message);
};
