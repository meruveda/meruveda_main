/**
 * Meta Cloud API error classification.
 *
 * Meta returns a numeric `error.code` and a human message. The client must
 * never see either raw string (it can leak internals and it is useless to a
 * customer), but the server log must always carry the code so a failure can
 * be diagnosed without guessing.
 *
 * This module maps a Meta error into a small, closed set of kinds:
 *   - 'invalid_number'  the number is not a usable WhatsApp recipient
 *   - 'rate_limited'    Meta is throttling us; the customer should retry later
 *   - 'template'        the template is missing/rejected/mis-parameterised
 *   - 'auth'            our token or permissions are wrong
 *   - 'service'         Meta is having a problem on its side
 *   - 'unknown'         anything else
 */

export type MetaErrorKind =
  | 'invalid_number'
  | 'rate_limited'
  | 'template'
  | 'auth'
  | 'service'
  | 'unknown';

export interface ClassifiedMetaError {
  kind: MetaErrorKind;
  /** HTTP status from Meta (400, 401, 403, 429, 500...). */
  status?: number;
  /** Meta's numeric error code — logged, never returned to the client. */
  code?: number;
  /** Meta's error subcode — logged, never returned to the client. */
  errorSubcode?: number;
  /** Meta's message — logged, never returned to the client. */
  message?: string;
}

/** Meta error codes that mean "this phone number cannot receive the message". */
const INVALID_NUMBER_CODES = new Set([
  131026, // message undeliverable, recipient not on WhatsApp
  131052, // recipient is not a valid WhatsApp user
  131047, // recipient outside the 24h customer service window
  131049, // display name mismatch
]);

/** Meta error codes that mean "slow down". */
const RATE_LIMIT_CODES = new Set([
  4, // application request limit reached
  80007, // rate limit hit
  130429, // rate limit hit
  131048, // spam rate limit
  131056, // pair rate limit hit
  133016, // too many messages
  368, // temporarily blocked
  131048, // duplicate pair rate limit
]);

/** Meta error codes that mean "the template is the problem". */
const TEMPLATE_CODES = new Set([
  132001, // template name does not exist in the translation
  132005, // template does not exist
  132007, // template format is invalid
  132012, // template parameter format mismatch
  132015, // template is not in the approved language
  132016, // template is paused
  140034, // template name is invalid
  132068, // template is not approved
  132069, // template is archived
]);

/** Meta error codes that mean "our credentials are wrong". */
const AUTH_CODES = new Set([
  190, // access token has expired
  200, // API permission not granted
  10, // permission denied
  33, // page/token not found
  803, // unknown error
]);

/** Meta error codes that mean "Meta is broken right now". */
const SERVICE_CODES = new Set([
  1, // API unknown / internal
  2, // API service
  17, // api too many calls
  32, // parameter value invalid
  613, // custom rate limit hit
]);

export function classifyMetaError(err: any): ClassifiedMetaError {
  const code = typeof err?.code === 'number' ? err.code : undefined;
  const errorSubcode = typeof err?.errorSubcode === 'number' ? err.errorSubcode : undefined;
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const message = err?.message ? String(err.message) : undefined;

  // A message-only failure (network error, thrown Error) is a service issue.
  if (code === undefined) {
    return { kind: 'service', status, message };
  }

  if (INVALID_NUMBER_CODES.has(code)) return { kind: 'invalid_number', status, code, errorSubcode, message };
  if (RATE_LIMIT_CODES.has(code)) return { kind: 'rate_limited', status, code, errorSubcode, message };
  if (TEMPLATE_CODES.has(code)) return { kind: 'template', status, code, errorSubcode, message };
  if (AUTH_CODES.has(code)) return { kind: 'auth', status, code, errorSubcode, message };
  if (SERVICE_CODES.has(code)) return { kind: 'service', status, code, errorSubcode, message };

  if (status === 401 || status === 403) return { kind: 'auth', status, code, errorSubcode, message };
  if (status === 429) return { kind: 'rate_limited', status, code, errorSubcode, message };
  if (status === 400 && /template/i.test(message || '')) {
    return { kind: 'template', status, code, errorSubcode, message };
  }
  if (status === 400 && /phone|recipient|msisdn/i.test(message || '')) {
    return { kind: 'invalid_number', status, code, errorSubcode, message };
  }
  if (status && status >= 500) return { kind: 'service', status, code, errorSubcode, message };

  return { kind: 'unknown', status, code, errorSubcode, message };
}

/**
 * The message shown to the customer for a given kind.
 *
 * Deliberately specific but non-technical: the customer learns whether the
 * problem is their number, our service, or a temporary pause — which is the
 * difference between "fix your input" and "try again later".
 */
export function customerMessageForKind(kind: MetaErrorKind): string {
  switch (kind) {
    case 'invalid_number':
      return 'This WhatsApp number cannot receive messages. Please check the number and try again.';
    case 'rate_limited':
      return 'We are sending a lot of codes right now. Please wait a minute and try again.';
    case 'template':
      return 'We could not send the verification code on WhatsApp. Please try again in a few minutes.';
    case 'auth':
    case 'service':
      return 'WhatsApp is temporarily unavailable. Please try again in a few minutes.';
    default:
      return 'We could not send the verification code on WhatsApp. Please try again in a few minutes.';
  }
}

/** The HTTP status the API should return for a given kind. */
export function statusForKind(kind: MetaErrorKind): number {
  switch (kind) {
    case 'invalid_number':
      return 400;
    case 'rate_limited':
      return 429;
    default:
      return 503;
  }
}
