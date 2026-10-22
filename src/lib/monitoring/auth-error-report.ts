import * as Sentry from "@sentry/nextjs";

/**
 * Sends a signup / sign-in failure to Sentry.
 *
 * TOMBSTONE: until this existed, the signup and login forms, `/auth/callback`
 * and `/auth/confirm` only `console.error`ed their failures. A signup flow
 * broken in production (an expired-link storm, a Supabase config change,
 * signups disabled) was invisible to operators: the browser console is the
 * customer's, and the route logs were read by nobody.
 *
 * PII: Supabase puts the address in some messages (`Email address "x@y" is
 * invalid`), and its error objects can carry more. So the original error is
 * never sent: Sentry receives a fresh `Error` whose message is the step plus
 * the email-redacted message, and only non-identifying tags — `area:auth`, the
 * step, Supabase's `code`/`status` and whatever the caller adds. No extras,
 * no user.
 */

const EMAIL_PATTERN = /[^\s"'<>@()[\]]+@[^\s"'<>@()[\]]+/g;

type AuthErrorShape = { message?: unknown; code?: unknown; status?: unknown };

function asShape(error: unknown): AuthErrorShape {
  return typeof error === "object" && error !== null
    ? (error as AuthErrorShape)
    : {};
}

export function reportAuthError(
  step: string,
  error: unknown,
  tags: Record<string, string> = {},
): void {
  const { message, code, status } = asShape(error);
  const safeMessage =
    typeof message === "string" && message.length > 0
      ? message.replace(EMAIL_PATTERN, "[email]")
      : "unknown error";

  try {
    Sentry.captureException(new Error(`[auth] ${step}: ${safeMessage}`), {
      tags: {
        area: "auth",
        auth_step: step,
        ...(typeof code === "string" ? { auth_code: code } : {}),
        ...(typeof status === "number" ? { auth_status: String(status) } : {}),
        ...tags,
      },
    });
  } catch {
    // Reporting must never turn an auth failure into a crash; the caller
    // has already logged the cause.
  }
}
