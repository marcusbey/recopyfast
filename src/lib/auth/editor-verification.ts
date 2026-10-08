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

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Charge one attempt against a code, atomically, BEFORE it is compared.
 *
 * s68b M3. The counter used to be read-then-write: read `attempts = k`,
 * compare, write `k + 1`. Twenty concurrent guesses all read the same `k`, were
 * all compared, and all wrote the same `k + 1` — a burst bought as many
 * comparisons as it had requests, while the row recorded one. The charge is now
 * a compare-and-set through PostgREST (`… WHERE attempts = k AND consumed_at IS
 * NULL`, returning the row), so only a request whose increment landed may
 * compare, and at most MAX_CODE_ATTEMPTS increments can ever land per code.
 *
 * A request that loses the race re-reads the row and tries again while the code
 * is live, rather than giving up: every loss means another guess was charged,
 * so the loop is bounded by MAX_CODE_ATTEMPTS, and a burst ends with the code
 * burned (`attempts = MAX`, `consumed_at` set) instead of left live with one
 * attempt recorded. It also keeps a genuine editor's single submit from being
 * refused just because a guess raced it.
 *
 * Returns "charged_last" when this charge spent the final attempt (and so also
 * consumed the code), "spent" when the code was used up or consumed before this
 * request could be charged.
 */
async function chargeAttempt(
  supabase: ServiceClient,
  record: { id: string; attempts: number },
): Promise<"charged" | "charged_last" | "spent" | "error"> {
  let attempts = record.attempts;

  // Bound: MAX_CODE_ATTEMPTS + 1 = 6 rounds per request, and at most 5 charges (so ≤ 5 comparisons) ever land per code.
  for (let round = 0; round <= MAX_CODE_ATTEMPTS; round++) {
    if (attempts >= MAX_CODE_ATTEMPTS) return "spent";

    const next = attempts + 1;
    const isLast = next >= MAX_CODE_ATTEMPTS;
    const { data: charged, error } = await supabase
      .from("editor_verification_codes")
      .update({
        attempts: next,
        // Burn the code with the last permitted charge rather than leaving a
        // spent-but-live row for the next request to find.
        ...(isLast ? { consumed_at: new Date().toISOString() } : {}),
      })
      .eq("id", record.id)
      .eq("attempts", attempts)
      .is("consumed_at", null)
      .select("id");

    if (error) {
      console.error(
        "[editor-verification] attempt charge failed:",
        error.message,
      );
      return "error";
    }
    if (charged && charged.length > 0) {
      return isLast ? "charged_last" : "charged";
    }

    const { data: fresh, error: readError } = await supabase
      .from("editor_verification_codes")
      .select("attempts, consumed_at")
      .eq("id", record.id)
      .maybeSingle();

    if (readError) {
      console.error(
        "[editor-verification] attempt re-read failed:",
        readError.message,
      );
      return "error";
    }
    if (!fresh || fresh.consumed_at) return "spent";
    attempts = fresh.attempts;
  }

  return "spent";
}

/**
 * Check a submitted code and consume it on success.
 *
 * Ordering matters: the attempt is charged before the code is compared (see
 * chargeAttempt), so a client that disconnects mid-request still pays for its
 * guess, and concurrent guesses cannot share one charge.
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

  const charge = await chargeAttempt(supabase, record);
  if (charge === "error") return { ok: false, reason: "error" };
  // Lost every compare-and-set to concurrent guesses until the code was spent:
  // answered exactly like a wrong code, and never compared.
  if (charge === "spent") return { ok: false, reason: "mismatch" };

  const matches = timingSafeEqualString(
    record.code_hash,
    hashVerificationCode(email, params.code),
  );

  if (!matches) return { ok: false, reason: "mismatch" };

  // The charge that spent the last permitted attempt also set `consumed_at`,
  // and only one request can win that compare-and-set: it already is the
  // single-use serialisation point, so a match here is the one winner.
  if (charge === "charged_last") return { ok: true };

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
