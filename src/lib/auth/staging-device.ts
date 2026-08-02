/**
 * Device binding for staging access.
 *
 * The problem this exists to solve
 * -------------------------------
 * `staging_access.email_verified` is a permanent boolean on a row keyed by a
 * token that travels in a URL. Once the real invitee entered their code, that
 * flag vouched for *every later bearer of the same URL* until the row expired —
 * up to 30 days. Forwarding the link forwarded the authorisation, with no second
 * factor, no device binding, and no way for the owner to tell it had happened.
 *
 * That is the same class of flaw the editor-access migration
 * (20260801100000_editor_access_2fa.sql) was written to fix; it closed it only
 * for `access_type='link'` rows with no email, leaving every invite open.
 *
 * Why a fingerprint rather than a device grant
 * -------------------------------------------
 * The obviously better answer is the signed, per-device grant that
 * src/lib/auth/editor-grants.ts already issues — it is well built and currently
 * unused. It cannot be used here: a grant has to be *stored and re-presented by
 * the client*, and the only client of the staging flow is the embed widget,
 * which has no code to do that and is owned by another workstream. Reaching for
 * grants would mean shipping a server change that nothing can exercise.
 *
 * So the binding has to be derivable from what the widget already sends on every
 * request: the token, plus request headers. That is a fingerprint recorded at
 * the moment the code was accepted and re-checked on each use.
 *
 * What is enforced, and what is not
 * --------------------------------
 * ENFORCED: the User-Agent hash. This is the axis that actually differs between
 * "the invitee's browser" and "whoever they forwarded the link to" — a different
 * person on a different machine sends a different UA. Same choice, and the same
 * whole-string hash, as `validateDeviceGrant` (editor-grants.ts:305).
 *
 * NOT ENFORCED, recorded for audit only:
 *   - origin. A forwarded link is opened on the *same site*, so the origin is
 *     identical for attacker and victim and enforcing it buys nothing against
 *     this threat. Cross-site use is already refused by the `site_id` filter in
 *     `validateStagingAccess`. Enforcing it would only add false rejections for
 *     callers that legitimately send no Origin header.
 *   - IP prefix. Mobile clients change IP constantly; hard-binding would lock
 *     out honest invitees far more often than it would stop someone who already
 *     holds the token. Same reasoning as `editor_device_grants.ip_prefix`.
 *
 * Honest limitation
 * -----------------
 * A User-Agent is attacker-supplied and trivially forged by a non-browser
 * client. This stops a forwarded *URL* — the realistic case, where the token is
 * pasted into Slack and opened in someone else's browser — not an attacker who
 * captured the token together with the victim's headers and replays both. It is
 * a browser-enforced control, exactly like the origin binding on device grants
 * (see the note at editor-grants.ts:230). The time bound below is what limits
 * the damage when the fingerprint is defeated.
 */

import {
  hashOrigin,
  hashUserAgent,
  normalizeOrigin,
  timingSafeEqualString,
  toIpPrefix,
} from "@/lib/auth/editor-crypto";

/**
 * How long a successful verification vouches for a device.
 *
 * Defence in depth behind the fingerprint: even if the UA check is defeated, a
 * forwarded URL is inert once this elapses. Matches SESSION_GRANT_TTL_MS in
 * editor-grants.ts — a working day, so a legitimate invitee entering a code once
 * per session is the expected cost, not once per page load.
 */
export const STAGING_VERIFICATION_TTL_MS = 12 * 60 * 60 * 1000;

export interface StagingDeviceFingerprint {
  /** Enforced. */
  userAgentHash: string;
  /** Audit only — see module header. */
  originHash: string;
  /** Audit only — see module header. */
  ipPrefix: string | null;
}

/** The subset of a request this module reads. Keeps it testable without NextRequest. */
type FingerprintSource = Pick<Request, "headers">;

/**
 * Client IP from proxy headers.
 *
 * Deliberately not imported from `@/lib/api/rate-limit`: that helper takes a
 * NextRequest, and this module is called from plain-Request contexts too. The
 * value is only ever truncated for audit, so the two need not agree exactly.
 */
function readClientIp(request: FingerprintSource): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

export function readStagingDeviceFingerprint(
  request: FingerprintSource,
): StagingDeviceFingerprint {
  const origin = normalizeOrigin(request.headers.get("origin"));

  return {
    userAgentHash: hashUserAgent(request.headers.get("user-agent")),
    // A missing Origin hashes to a stable, non-empty value rather than "", so a
    // recorded fingerprint is never accidentally comparable to an absent one.
    originHash: hashOrigin(origin ?? ""),
    ipPrefix: toIpPrefix(readClientIp(request)),
  };
}

export interface RecordedStagingVerification {
  userAgentHash: string | null;
  verifiedAt: string | null;
}

export type StagingBindingRejection = "unbound" | "device_mismatch" | "stale";

export type StagingBindingCheck =
  | { ok: true }
  | { ok: false; reason: StagingBindingRejection };

/**
 * Does this request come from the device that passed verification, recently
 * enough to still be trusted?
 *
 * Fails CLOSED on a missing record. Rows verified before this binding existed
 * carry no fingerprint, and grandfathering them in would leave every
 * already-forwarded URL working — which is the whole vulnerability. The cost is
 * one re-verification for anyone holding a live verified token at deploy time.
 */
export function checkStagingDeviceBinding(
  recorded: RecordedStagingVerification,
  presented: StagingDeviceFingerprint,
  now: number = Date.now(),
): StagingBindingCheck {
  if (!recorded.userAgentHash || !recorded.verifiedAt) {
    return { ok: false, reason: "unbound" };
  }

  const verifiedAtMs = new Date(recorded.verifiedAt).getTime();
  if (!Number.isFinite(verifiedAtMs)) {
    return { ok: false, reason: "unbound" };
  }

  if (now - verifiedAtMs > STAGING_VERIFICATION_TTL_MS) {
    return { ok: false, reason: "stale" };
  }

  if (!timingSafeEqualString(recorded.userAgentHash, presented.userAgentHash)) {
    return { ok: false, reason: "device_mismatch" };
  }

  return { ok: true };
}
