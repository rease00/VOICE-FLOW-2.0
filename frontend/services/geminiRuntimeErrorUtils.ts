const RUNTIME_QUOTA_MESSAGE = 'Usage limit exceeded. Please check your AI slot configuration in settings.';

const GEMINI_CAPACITY_PRESSURE_ERROR_CODES = [
  'GEMINI_SLOT_SET_OVERLOADED',
  'GEMINI_SLOT_SET_TIMEOUT',
  'GEMINI_ALLOCATOR_ACQUIRE_TIMEOUT',
  'GEMINI_ALL_SLOTS_RATE_LIMITED',
];

const GEMINI_RETRYABLE_TIMEOUT_ERROR_CODES = [
  'GEMINI_UPSTREAM_REQUEST_TIMEOUT',
];

export const isKnownGeminiPoolMisconfigError = (message: string): boolean => {
  const lower = String(message || '').toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('gemini_slot_set_missing') ||
    lower.includes('slot set is empty') ||
    lower.includes('configure the backend-held service-account slots') ||
    lower.includes('slot configuration is missing')
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
    lower.includes('gemini slot set is temporarily overloaded') ||
    lower.includes('gemini slot set timed out while waiting for an available slot') ||
    lower.includes(RUNTIME_QUOTA_MESSAGE.toLowerCase()) ||
    (lower.includes('availablelanes=0') && lower.includes('slotcount='))
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
