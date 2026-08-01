/**
 * The ephemeral half of editor access: proving, right now, that the person at
 * the keyboard controls the mailbox.
 *
 * The code is an event with a lifetime, not a flag on a row. That is the whole
 * correction to the previous design, where `staging_access.email_verified` was
 * set once by whoever opened the link first and then vouched for every later
 * bearer of the same token.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  generateVerificationCode,
  hashVerificationCode,
  timingSafeEqualString,
} from "@/lib/auth/editor-crypto";
import { normalizeEmail } from "@/lib/auth/editor-directory";

/** Long enough to find the mail, short enough that a leaked code is stale fast. */
export const CODE_TTL_MINUTES = 10;

/**
 * Attempts allowed against a single issued code before it is burned.
 *
 * This is a second, independent cap alongside the Redis rate limit in the route.
 * The Redis limit is the primary control; this one lives in the same database as
 * the code itself, so it still holds if the limiter is unavailable and an
 * endpoint were ever configured to fail open.
 */
export const MAX_CODE_ATTEMPTS = 5;

export type CodeCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_code" | "expired" | "mismatch" | "exhausted" | "error";
    };

/**
 * Issue a code and return it to the caller for delivery by email.
 *
 * The code is returned exactly once, in process, to the function that emails it.
 * It is never persisted in plaintext and never enters an HTTP response — doing
 * either would let the requester self-verify without controlling the mailbox,
 * which is the entire point of the factor.
 *
 * `siteId` of null scopes the code to the hub, where the address has not yet
 * chosen a site.
 */
export async function issueVerificationCode(params: {
  email: string;
  siteId: string | null;
}): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const email = normalizeEmail(params.email);
  const code = generateVerificationCode();

  // Retire any codes still outstanding for this scope. Without this, every
  // resend widens the set of currently-valid codes and multiplies an attacker's
  // chance of a blind hit.
  const { error: supersedeError } = await supabase
    .from("editor_verification_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("email", email)
    .is("consumed_at", null)
    .filter("site_id", params.siteId ? "eq" : "is", params.siteId ?? null);

  if (supersedeError) {
    console.error(
      "[editor-verification] could not supersede prior codes:",
      supersedeError.message,
    );
    return null;
  }

  const { error } = await supabase.from("editor_verification_codes").insert({
    email,
    site_id: params.siteId,
    code_hash: hashVerificationCode(email, code),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
  });

  if (error) {
    console.error("[editor-verification] could not store code:", error.message);
    return null;
  }

  return code;
}

/**
 * Check a submitted code and consume it on success.
 *
 * Ordering matters: the attempt is recorded before the answer is returned, so a
 * client that disconnects mid-request still pays for its guess.
 */
export async function consumeVerificationCode(params: {
  email: string;
  siteId: string | null;
  code: string;
}): Promise<CodeCheckResult> {
  const supabase = createServiceRoleClient();
  const email = normalizeEmail(params.email);

  const { data: rows, error } = await supabase
    .from("editor_verification_codes")
    .select("id, code_hash, attempts, expires_at")
    .eq("email", email)
    .filter("site_id", params.siteId ? "eq" : "is", params.siteId ?? null)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[editor-verification] lookup failed:", error.message);
    return { ok: false, reason: "error" };
  }

  const record = rows?.[0];
  if (!record) return { ok: false, reason: "no_code" };

  if (new Date(record.expires_at).getTime() <= Date.now()) {
    await supabase
      .from("editor_verification_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", record.id);
    return { ok: false, reason: "expired" };
  }

  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    await supabase
      .from("editor_verification_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", record.id);
    return { ok: false, reason: "exhausted" };
  }

  const matches = timingSafeEqualString(
    record.code_hash,
    hashVerificationCode(email, params.code),
  );

  if (!matches) {
    const attempts = record.attempts + 1;
    await supabase
      .from("editor_verification_codes")
      .update({
        attempts,
        // Burn the code on the last permitted miss rather than leaving a
        // spent-but-live row for the next request to find.
        consumed_at:
          attempts >= MAX_CODE_ATTEMPTS ? new Date().toISOString() : null,
      })
      .eq("id", record.id);
    return { ok: false, reason: "mismatch" };
  }

  // Single use. The conditional `is('consumed_at', null)` makes this the
  // serialisation point: two requests racing with the correct code produce
  // exactly one winner.
  const { data: consumed, error: consumeError } = await supabase
    .from("editor_verification_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", record.id)
    .is("consumed_at", null)
    .select("id");

  if (consumeError) {
    console.error(
      "[editor-verification] consume failed:",
      consumeError.message,
    );
    return { ok: false, reason: "error" };
  }

  if (!consumed || consumed.length === 0) {
    // Lost the race — the code was already spent by a concurrent request.
    return { ok: false, reason: "no_code" };
  }

  return { ok: true };
}
