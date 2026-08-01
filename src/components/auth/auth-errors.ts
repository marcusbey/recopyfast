/**
 * Maps Supabase Auth failures onto messages that are safe to show a user.
 *
 * Two rules drive every mapping here:
 *  1. Never leak whether an email address is registered. Account-enumeration
 *     probes must look identical to the happy path.
 *  2. Never swallow an error. Anything we cannot classify still returns a
 *     message, and `logAuthError` keeps the raw cause in the console for
 *     debugging.
 */

/** Fallback shown when an error cannot be classified. */
const GENERIC_MESSAGE =
  "Something went wrong. Please try again in a few moments.";

/** Shape of the parts of a Supabase `AuthError` we care about. */
interface AuthErrorLike {
  message: string;
  status?: number;
  code?: string;
}

function toAuthErrorLike(error: unknown): AuthErrorLike {
  if (error instanceof Error) {
    const withMeta = error as Error & { status?: unknown; code?: unknown };
    return {
      message: error.message,
      status: typeof withMeta.status === "number" ? withMeta.status : undefined,
      code: typeof withMeta.code === "string" ? withMeta.code : undefined,
    };
  }

  if (typeof error === "string") return { message: error };

  return { message: "" };
}

/**
 * Translate an unknown thrown value into a user-facing message.
 *
 * Matching is done on Supabase's `code` first (stable across versions) and
 * falls back to substring matching on `message` for older releases that only
 * populated the message.
 */
export function getAuthErrorMessage(error: unknown): string {
  const { message, status, code } = toAuthErrorLike(error);
  const haystack = message.toLowerCase();

  // Rate limiting — Supabase returns 429, sometimes with a retry hint.
  if (
    status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    haystack.includes("rate limit") ||
    haystack.includes("too many requests") ||
    haystack.includes("you can only request this after")
  ) {
    return "Too many attempts. Please wait a minute and try again.";
  }

  // Wrong email/password on the password sign-in path.
  if (
    code === "invalid_credentials" ||
    haystack.includes("invalid login credentials")
  ) {
    return "That email or password is incorrect.";
  }

  // Account exists but the address was never confirmed.
  if (
    code === "email_not_confirmed" ||
    haystack.includes("email not confirmed")
  ) {
    return "Your email address isn't confirmed yet. Check your inbox for the confirmation link.";
  }

  // Recovery / magic links that were already used, expired, or tampered with.
  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    code === "flow_state_not_found" ||
    haystack.includes("token has expired") ||
    haystack.includes("invalid flow state") ||
    haystack.includes("code verifier") ||
    haystack.includes("both auth code and code verifier")
  ) {
    return "This link is invalid or has expired. Request a new one to continue.";
  }

  // Password policy rejections from `updateUser`.
  if (
    code === "weak_password" ||
    haystack.includes("password should be at least") ||
    haystack.includes("password is too weak")
  ) {
    return message || "Please choose a stronger password.";
  }

  if (
    code === "same_password" ||
    haystack.includes("should be different from the old password")
  ) {
    return "Your new password must be different from your current one.";
  }

  // Signups disabled at the project level.
  if (code === "signup_disabled" || haystack.includes("signups not allowed")) {
    return "New account signups are currently disabled.";
  }

  // Offline / DNS / CORS — `fetch` rejects with a TypeError.
  if (
    haystack.includes("failed to fetch") ||
    haystack.includes("networkerror") ||
    haystack.includes("network request failed")
  ) {
    return "We couldn't reach the server. Check your connection and try again.";
  }

  return GENERIC_MESSAGE;
}

/**
 * Record the raw error for operators while the user sees the mapped message.
 * Keeps us from silently discarding the underlying cause.
 */
export function logAuthError(context: string, error: unknown): void {
  console.error(`[auth] ${context}`, error);
}
