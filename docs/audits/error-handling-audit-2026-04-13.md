# Error Handling Patterns Audit

**Project:** Voice-Flow  
**Date:** 2026-04-13  
**Auditor:** Automated Audit  
**Status:** Completed  

## Executive Summary

The Voice-Flow project demonstrates a **mature and well-structured error handling architecture** with clear separation between technical error details and user-facing messages. The error handling system shows strong security consciousness with comprehensive sanitization patterns to prevent sensitive information leakage.

**Overall Rating:** ✅ **Good** - Well-designed error handling with comprehensive pattern matching and telemetry integration.

---

## 1. Error Utilities Assessment

### 1.1 Core Error Formatter: [`formatFrontendError.ts`](frontend/src/shared/errors/formatFrontendError.ts)

**Strengths:**

- **Comprehensive Pattern Classification:** The module defines extensive pattern lists for error categorization:
  - Network patterns (lines 35-48): CORS, connection refused, socket hang up
  - Timeout patterns (lines 50-56): timeout, deadline exceeded
  - Auth patterns (lines 58-71): bearer token, authentication failures
  - Admin restriction patterns (lines 73-78): permission denied, forbidden
  - Service account credential patterns (lines 80-88): prevents GCP credential leakage
  - Quota/balance patterns (lines 104-119): rate limiting, wallet balance
  - Runtime patterns (lines 148-169): slot set, upstream failures, chunk errors

- **Security-First Approach:** 
  - `SENSITIVE_TECHNICAL_PATTERNS` (lines 171-197) explicitly blocks internal details
  - `TECHNICAL_TOKENS` (lines 199-219) identifies trace IDs, stack traces, URLs
  - URL/host patterns regex (line 221) catches internal endpoints
  - JSON pattern detection prevents raw API responses from reaching users

- **Context-Aware Messaging:** 
  - `FrontendErrorContext` type (lines 3-10) supports: auth, generation, billing, support, media, runtime, generic
  - Context-specific copy functions (lines 243-260) provide tailored messages per domain

- **Admin vs User Separation:**
  - `FormattedFrontendError` interface (lines 18-23) separates `publicMessage` from optional `adminDetails`
  - Admin users receive additional diagnostic information while regular users see sanitized messages

**Code Quality Example:**
```typescript
// Lines 334-432: Main formatting function
export const formatFrontendError = (
  errorLike: unknown,
  options: FormatFrontendErrorOptions = {}
): FormattedFrontendError => {
  // Sanitizes raw message, checks patterns, returns appropriate public copy
  // Admin details only included when isAdmin: true
```

### 1.2 Test Coverage: [`formatFrontendError.test.ts`](frontend/src/shared/errors/formatFrontendError.test.ts)

**Coverage Assessment:** ✅ **Good**

Tests verify:
- Network/CORS failure mapping (lines 5-12)
- Timeout handling (lines 14-21)
- Auth/profile gating without backend detail leakage (lines 23-58)
- Quota and billing error handling (lines 60-74)
- JSON/trace ID suppression for non-admin users (lines 76-87)
- Admin diagnostic preservation (lines 89-102)
- Safe message pass-through (lines 104-111)
- Runtime error code mapping (lines 113-157)
- Technical token suppression (lines 159-166)

**Gap Identified:** No explicit tests for:
- Unicode/emoji in error messages
- Very long error messages (>10KB)
- Circular reference objects

---

## 2. Runtime Error Handling

### 2.1 Runtime Switch Errors: [`runtimeSwitchErrors.ts`](frontend/src/shared/runtime/runtimeSwitchErrors.ts)

**Assessment:** ✅ **Simple and Focused**

The module provides clean error classification for runtime switching:
- `normalizeRuntimeSwitchErrorMessage()` (lines 1-3): Lowercases and trims for consistent matching
- `isRuntimeSwitchUnlockError()` (lines 5-13): Detects admin unlock requirements
- `isRuntimeSwitchPermissionError()` (lines 15-26): Identifies permission denied scenarios
- `buildRuntimeSwitchReadOnlyMessage()` (lines 28-30): Constructs user-appropriate message

**Strength:** No sensitive information exposed in error messages.

### 2.2 Gemini Runtime Error Utils: [`geminiRuntimeErrorUtils.ts`](frontend/services/geminiRuntimeErrorUtils.ts)

**Assessment:** ✅ **Well-Structured**

Provides specialized error detection for Gemini TTS runtime:
- Capacity pressure detection (lines 25-38): Handles slot overload, saturation
- Retryable timeout detection (lines 40-48): Identifies upstream timeouts
- Pool misconfig detection (lines 14-23): Catches configuration errors
- Fail-fast decision logic (lines 50-52): Combines checks appropriately

**Error Codes Handled:**
- `GEMINI_SLOT_SET_OVERLOADED`
- `GEMINI_SLOT_SET_TIMEOUT`
- `GEMINI_ALLOCATOR_ACQUIRE_TIMEOUT`
- `GEMINI_ALL_SLOTS_RATE_LIMITED`
- `GEMINI_UPSTREAM_REQUEST_TIMEOUT`

### 2.3 Gemini Service Error Handling: [`geminiService.ts`](frontend/services/geminiService.ts)

**Assessment:** ✅ **Comprehensive**

Key error handling patterns identified:

1. **Error Normalization** (lines 101-138):
   - `collapseRuntimeErrorWhitespace()`: Normalizes multi-line errors
   - `truncateRuntimeErrorDetail()`: Limits to 220 chars (line 98)
   - `isRuntimeQuotaLikeError()`: Detects 429, quota exceeded, rate limit

2. **Error Code Mapping** (lines 140-168):
   - `mapGeminiRuntimeErrorCode()`: Maps internal codes to user messages
   - Handles: `GEMINI_API_KEY_MISSING`, `GEMINI_RUNTIME_SDK_UNAVAILABLE`, `GEMINI_ALL_KEYS_AUTH_FAILED`, etc.

3. **JSON Error Parsing** (lines 170-186):
   - `parseMaybeJsonObject()`: Safely extracts nested error objects
   - Handles both string and object payloads

4. **Runtime Error Detail Parsing** (lines 188-225):
   - `parseRuntimeErrorDetail()`: Comprehensive extraction from various payload formats
   - Prioritizes: errorCode → summary → detail → error → status/statusText

**Diagnostic Events:**
- `TTS_RUNTIME_DIAGNOSTICS_EVENT` (line 28): Custom event for runtime diagnostics
- `TTS_GATEWAY_JOB_PROGRESS_EVENT` (line 29): Job progress tracking
- `TTS_GATEWAY_AUDIO_CHUNK_EVENT` (line 30): Audio chunk delivery tracking

---

## 3. Telemetry & Logging

### 3.1 Frontend Error Reporting: [`frontendErrors.ts`](frontend/src/shared/telemetry/frontendErrors.ts)

**Assessment:** ✅ **Production-Ready**

**Features:**
- **Telemetry Toggle** (lines 15-21): Environment-based enable/disable
- **Sampling Rate** (lines 23-37): Configurable error sampling (0-1 range)
- **Severity Normalization** (lines 39-44): Maps warn→warning, fatal→critical
- **Best-Effort Delivery** (lines 67-69): Silent catch on telemetry failure

**Payload Structure:**
```typescript
interface FrontendErrorPayload {
  message: string;
  route?: string;
  component?: string;
  severity?: FrontendErrorSeverity;
  stack?: string;
  metadata?: Record<string, unknown>;
}
```

**Endpoint:** `/ops/guardian/frontend-errors` (line 59)

**Security Consideration:** ✅ Telemetry requires authentication (`requireAuth: true` at line 65)

### 3.2 Notification Format: [`format.ts`](frontend/src/shared/notifications/format.ts)

**Assessment:** ✅ **Consistent with Error Formatter**

Mirrors the pattern-matching approach of `formatFrontendError.ts`:
- Network patterns (lines 4-13)
- Timeout patterns (line 15)
- Auth/token patterns (lines 17-27)
- Admin restriction patterns (lines 28-36)
- Service account patterns (lines 37-45)
- Infrastructure leak patterns (lines 46-53)

**Key Function:** `toUserMessage()` (lines 67-100) converts error-like values to user-safe messages.

---

## 4. API Error Handling

### 4.1 Backend Proxy: [`proxy.ts`](frontend/app/api/backend/proxy.ts)

**Assessment:** ✅ **Robust with Security Controls**

**Security Features:**

1. **Path Whitelist** (lines 6-22):
   ```typescript
   DEFAULT_ALLOWED_PATH_PREFIXES = [
     '/account', '/admin', '/api', '/auth', '/billing',
     '/health', '/routing', '/runtime', '/support', '/tts',
     '/v1', '/v2', '/voice-clone', '/voice-lab', '/wallet'
   ]
   ```

2. **Header Sanitization** (lines 34-56):
   - `REQUEST_HEADER_ALLOWLIST`: Only safe headers forwarded
   - Prevents header injection attacks

3. **Spoofed Header Blocking** (lines 57-78):
   - Blocks `cf-`, `x-amzn-`, `x-envoy-`, `x-forwarded-` prefixes
   - Prevents client IP spoofing, host injection

4. **Authentication Requirement** (lines 302-323):
   - Write methods require auth context
   - Returns 401 for unauthenticated mutations

**Error Responses:**
- 403: Path not allowed (line 307-311)
- 405: Method not allowed (line 312-317)
- 401: Auth required for write (line 318-323)
- 502: Upstream failure (lines 370-385)

**Upstream Failure Handling** (lines 276-284):
```typescript
const toUpstreamFailureMessage = (target: URL, error: unknown): string => {
  // Constructs safe error message without exposing internal details
```

**Health Check Caching** (lines 162-189):
- 10-second TTL for backend health status
- 1.5s timeout for health probes
- Graceful fallback to all candidates if none healthy

---

## 5. User-Facing Error Handling

### 5.1 Error Boundaries: [`AppErrorBoundary.tsx`](frontend/src/app/errors/AppErrorBoundary.tsx)

**Assessment:** ✅ **Comprehensive React Error Handling**

**Components:**

1. **ReactAppErrorBoundary Class** (lines 111-149):
   - `getDerivedStateFromError()`: Captures error state
   - `componentDidCatch()`: Logs and reports errors
   - Stack trace preservation for debugging

2. **AppErrorBoundary Wrapper** (lines 151-274):
   - Integrates with notification system
   - Handles both React errors and window errors
   - Unhandled rejection classification

3. **Error Fallback UI** (lines 78-109):
   - Clean, branded error display
   - Retry and Reload buttons
   - Technical message in collapsible section

**Error Types Handled:**
- React render errors (line 184-191)
- Window errors (lines 194-207)
- Unhandled promise rejections (lines 209-248)

**Special Handling:**
- Media volume errors trigger settings sanitization (lines 26-31, 137-139, 258-263)
- Unhandled rejections classified for transient vs security issues (line 212)

**Telemetry Integration:**
- All errors reported via `reportFrontendError()` (lines 181, 233)
- Notification emitted for user visibility (lines 167-177, 224-232)

### 5.2 Notification Provider: [`NotificationProvider.tsx`](frontend/src/shared/notifications/NotificationProvider.tsx)

**Assessment:** ✅ **Well-Designed Toast System**

**Features:**
- Deduplication with cooldown (line 65: 6s default)
- Toast visible limit (line 67: max 2 visible)
- Generation failure escalation (lines 68-69, 94-98)
- Persistent notification sync with backend

**Error Escalation Logic** (lines 94-98):
```typescript
export const shouldEscalateRepeatedGenerationFailure = (message: string): boolean => {
  // Escalates runtime failures, suppresses known user-actionable errors
```

---

## 6. Error Classification Summary

| Category | Patterns | User Message Approach |
|----------|----------|----------------------|
| Network | CORS, fetch failed, connection refused | "Cannot connect to service. Check connection." |
| Timeout | timeout, deadline exceeded | "Request took too long. Please retry." |
| Auth | missing bearer, invalid token, unauthorized | "Sign in again and retry." |
| Permission | forbidden, permission denied, uid_not_allowlisted | "Action restricted for your account." |
| Quota | 429, rate limit, quota exceeded | "Temporarily rate-limited. Wait and retry." |
| Balance | insufficient, low balance, wallet | "Not enough VF balance." |
| Runtime | slot set, upstream failure, chunk errors | Context-specific runtime messages |
| Billing | checkout, stripe, invoice | "Billing temporarily unavailable." |
| Media | audio, video, upload, download | "Media processing failed. Please retry." |

---

## 7. Recommendations

### 7.1 High Priority

1. **Add Error Boundary Tests:** Create unit tests for `AppErrorBoundary.tsx` error capture and recovery flows.

2. **Expand Test Coverage for Edge Cases:**
   - Unicode/emoji in error messages
   - Very long error strings (>10KB)
   - Circular reference objects in error payloads

### 7.2 Medium Priority

3. **Centralize Pattern Definitions:** The pattern lists in `formatFrontendError.ts` and `format.ts` have significant overlap. Consider extracting to a shared constants file.

4. **Add Error Recovery Actions:** Some errors could benefit from automatic retry logic (e.g., network timeouts with exponential backoff).

5. **Document Error Codes:** Create a registry of all internal error codes (`GEMINI_*`, `chunk_failed`, etc.) with descriptions.

### 7.3 Low Priority

6. **Error Analytics Dashboard:** Consider aggregating error telemetry for trend analysis.

7. **Internationalization:** Error messages are currently English-only. Plan for i18n if expanding to other markets.

---

## 8. Security Assessment

**Overall:** ✅ **Strong security posture**

**Strengths:**
- Comprehensive sensitive data filtering
- No internal endpoints/credentials in user messages
- Admin-only access to detailed diagnostics
- Telemetry requires authentication
- Header injection prevention in proxy

**No Critical Issues Found**

---

## 9. Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| [`formatFrontendError.ts`](frontend/src/shared/errors/formatFrontendError.ts) | 433 | Core error formatting |
| [`formatFrontendError.test.ts`](frontend/src/shared/errors/formatFrontendError.test.ts) | 168 | Error formatter tests |
| [`runtimeSwitchErrors.ts`](frontend/src/shared/runtime/runtimeSwitchErrors.ts) | 32 | Runtime switch error classification |
| [`geminiRuntimeErrorUtils.ts`](frontend/services/geminiRuntimeErrorUtils.ts) | 53 | Gemini runtime error detection |
| [`geminiService.ts`](frontend/services/geminiService.ts) | 3449 | TTS service with error handling |
| [`frontendErrors.ts`](frontend/src/shared/telemetry/frontendErrors.ts) | 78 | Error telemetry reporting |
| [`proxy.ts`](frontend/app/api/backend/proxy.ts) | 387 | Backend proxy with error handling |
| [`AppErrorBoundary.tsx`](frontend/src/app/errors/AppErrorBoundary.tsx) | 275 | React error boundary |
| [`NotificationProvider.tsx`](frontend/src/shared/notifications/NotificationProvider.tsx) | 867 | Toast notification system |
| [`format.ts`](frontend/src/shared/notifications/format.ts) | 115 | Notification error formatting |

---

## 10. Conclusion

The Voice-Flow project implements a **mature error handling architecture** that effectively balances user experience with security requirements. The pattern-based error classification system is comprehensive and well-tested. The separation between public messages and admin diagnostics demonstrates good security practices.

The main areas for improvement are around test coverage expansion and potential consolidation of duplicate pattern definitions. The existing implementation provides a solid foundation for reliable error handling in production.

---

*Audit completed as part of the full project audit plan. See [`plans/full-project-audit-plan.md`](plans/full-project-audit-plan.md) for context.*
