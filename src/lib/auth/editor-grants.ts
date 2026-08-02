/**
 * Device grants: remembered proof of identity, bound to one browser on one
 * origin, for a bounded time.
 *
 * A grant is what the widget keeps in localStorage on the customer's own domain
 * once its holder has entered an emailed code. It is deliberately NOT a
 * capability on its own — every validation re-reads the durable `site_editors`
 * row, so the moment an owner revokes an editor the grant stops working, even
 * mid-session, without waiting for expiry.
 *
 * Why not a cookie: the widget runs on helloworld.com while the API is on
 * recopyfast.com, so any cookie we set would be third-party and is blocked by
 * default in every current browser. localStorage on the customer's origin is
 * first-party by construction; the token is designed to survive being stored
 * there, which is why it is signed, short-lived, and bound to the origin and
 * device that minted it.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  CRYPTO_DOMAIN,
  decodeSignedToken,
  encodeSignedToken,
  generateOpaqueSecret,
  hashOpaqueSecret,
  hashOrigin,
  hashUserAgent,
  timingSafeEqualString,
  toIpPrefix,
} from "@/lib/auth/editor-crypto";
import {
  normalizePermissions,
  type EditorPermission,
} from "@/lib/auth/editor-access";

const GRANT_PREFIX = "rcfg1";

/** "Remember this device" — long enough to be worth the checkbox. */
export const REMEMBERED_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The unchecked case. Not literally session-only on the server: the widget is
 * told to hold it in sessionStorage, and the server independently refuses it
 * after 12 hours so a tab left open overnight cannot be walked up to in the
 * morning.
 */
export const SESSION_GRANT_TTL_MS = 12 * 60 * 60 * 1000;

/** Refresh once the grant is within this window of expiring. */
export const GRANT_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * How long a superseded grant keeps working after a refresh.
 *
 * Two tabs on the same site share one localStorage entry, and only one of them
 * receives the replacement token. Without a grace window the other tab is logged
 * out mid-edit.
 *
 * Sixty seconds was too tight by a wide margin. Background tabs have their
 * timers throttled to minutes, a suspended laptop stops firing them entirely,
 * and a phone that loses signal in a lift comes back whenever it comes back —
 * so "the sibling tab's next call" is routinely minutes, not seconds, away.
 * Five minutes covers the ordinary cases without making rotation meaningless;
 * beyond it the token is refused, which is now a recoverable outcome rather
 * than a destructive one (see the replay note in `validateDeviceGrant`).
 */
export const GRANT_ROTATION_GRACE_MS = 5 * 60 * 1000;

interface GrantPayload {
  /** editor_device_grants.id */
  g: string;
  /** site the grant is for */
  s: string;
  /** origin fingerprint */
  o: string;
  /** expiry, epoch seconds */
  x: number;
  /** uniqueness, so two grants minted in the same second differ */
  n: string;
}

export type GrantRejection =
  | "malformed"
  | "expired"
  | "unknown"
  | "revoked"
  | "replayed"
  | "raced"
  | "editor_revoked"
  | "site_mismatch"
  | "origin_mismatch"
  | "device_mismatch"
  | "error";

export interface ValidatedGrant {
  grantId: string;
  siteEditorId: string;
  siteId: string;
  email: string;
  permissions: EditorPermission[];
  expiresAt: Date;
  /** True once the grant is close enough to expiry that the widget should refresh. */
  shouldRefresh: boolean;
}

export type GrantValidation =
  | { valid: true; grant: ValidatedGrant }
  | { valid: false; reason: GrantRejection };

export interface DeviceContext {
  origin: string;
  userAgent: string | null;
  ip: string | null;
}

/**
 * What the widget should do about a rejection.
 *
 * The precise reason is safe to return — the caller already knows which token,
 * origin and browser it used — and the widget needs to tell "ask for a code"
 * apart from "you are not an editor here, hide the pencil entirely".
 *
 * `refresh` means "the credential you presented is stale, but you are probably
 * still signed in — re-read the stored grant and retry once before prompting".
 * It exists because the common cause of a superseded token is a sibling tab
 * having rotated it, and that tab wrote the replacement to the same
 * localStorage entry this one is reading. Sending the user to a code prompt in
 * that situation is a needless interruption. Fall back to `verify` if the retry
 * is also refused.
 */
export function nextActionFor(
  reason: GrantRejection,
): "verify" | "hide" | "refresh" {
  switch (reason) {
    case "editor_revoked":
    case "site_mismatch":
      return "hide";
    case "replayed":
    case "raced":
      return "refresh";
    default:
      return "verify";
  }
}

/**
 * Mint a grant.
 *
 * Returns the raw token exactly once. Only its SHA-256 lands in the database, so
 * a dump of `editor_device_grants` yields nothing presentable — the same
 * discipline `api_keys.key_hash` already applies.
 */
export async function issueDeviceGrant(params: {
  siteEditorId: string;
  siteId: string;
  device: DeviceContext;
  rememberDevice: boolean;
  rotatedFrom?: string | null;
}): Promise<{ grant: string; expiresAt: Date } | null> {
  const supabase = createServiceRoleClient();

  const ttl = params.rememberDevice
    ? REMEMBERED_GRANT_TTL_MS
    : SESSION_GRANT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const originHash = hashOrigin(params.device.origin);

  // Insert first to obtain the row id, then sign a token that names it. The row
  // is unusable until grant_hash is filled in, so the intermediate state cannot
  // authenticate anyone.
  const { data: row, error: insertError } = await supabase
    .from("editor_device_grants")
    .insert({
      site_editor_id: params.siteEditorId,
      grant_hash: `pending:${generateOpaqueSecret(24)}`,
      user_agent_hash: hashUserAgent(params.device.userAgent),
      ip_prefix: toIpPrefix(params.device.ip),
      origin_hash: originHash,
      expires_at: expiresAt.toISOString(),
      rotated_from: params.rotatedFrom ?? null,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    console.error(
      "[editor-grants] could not create grant:",
      insertError?.message ?? "no row returned",
    );
    return null;
  }

  const payload: GrantPayload = {
    g: row.id,
    s: params.siteId,
    o: originHash,
    x: Math.floor(expiresAt.getTime() / 1000),
    n: generateOpaqueSecret(18),
  };
  const grant = encodeSignedToken(GRANT_PREFIX, CRYPTO_DOMAIN.grant, payload);

  const { error: sealError } = await supabase
    .from("editor_device_grants")
    .update({ grant_hash: hashOpaqueSecret(grant) })
    .eq("id", row.id);

  if (sealError) {
    console.error("[editor-grants] could not seal grant:", sealError.message);
    await supabase.from("editor_device_grants").delete().eq("id", row.id);
    return null;
  }

  return { grant, expiresAt };
}

/**
 * Validate a grant against everything it was bound to.
 *
 * Order is chosen so the cheapest rejections happen first and so no branch
 * reveals more than the caller already knows:
 *   1. signature and shape        — offline, no database round trip for forgeries
 *   2. payload expiry             — offline
 *   3. site and origin binding    — offline, from the signed payload
 *   4. the row, its parent editor, and the device fingerprint
 */
export async function validateDeviceGrant(params: {
  grant: string;
  siteId: string;
  device: DeviceContext;
}): Promise<GrantValidation> {
  const payload = decodeSignedToken<GrantPayload>(
    GRANT_PREFIX,
    CRYPTO_DOMAIN.grant,
    params.grant,
  );

  if (!payload?.g || !payload.s || !payload.x) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.x * 1000 <= Date.now()) {
    return { valid: false, reason: "expired" };
  }

  if (payload.s !== params.siteId) {
    return { valid: false, reason: "site_mismatch" };
  }

  // The binding that makes an exfiltrated grant worthless somewhere else. The
  // origin comes from the request headers, so this is a browser-enforced control
  // rather than a cryptographic one — see the note in the module header of
  // editor-grants and the report: it stops a copied token, not a forged header.
  if (
    !timingSafeEqualString(payload.o ?? "", hashOrigin(params.device.origin))
  ) {
    return { valid: false, reason: "origin_mismatch" };
  }

  const supabase = createServiceRoleClient();

  const { data: row, error } = await supabase
    .from("editor_device_grants")
    .select(
      "id, site_editor_id, grant_hash, user_agent_hash, origin_hash, expires_at, revoked_at, revoked_reason, site_editors!inner(id, site_id, email, permissions, revoked_at)",
    )
    .eq("id", payload.g)
    .maybeSingle();

  if (error) {
    console.error("[editor-grants] validation lookup failed:", error.message);
    return { valid: false, reason: "error" };
  }
  if (!row) return { valid: false, reason: "unknown" };

  // The signature proves we minted a token naming this row; the hash proves it
  // is *this* token and not an earlier one for the same row.
  if (!timingSafeEqualString(row.grant_hash, hashOpaqueSecret(params.grant))) {
    return { valid: false, reason: "unknown" };
  }

  if (row.revoked_at) {
    const revokedAt = new Date(row.revoked_at).getTime();
    const withinGrace = Date.now() - revokedAt <= GRANT_ROTATION_GRACE_MS;

    if (row.revoked_reason === "rotated" && withinGrace) {
      // A sibling tab refreshed moments ago and this request still carries the
      // old token. Expected; let it through, it will pick up the new one.
    } else if (row.revoked_reason === "rotated") {
      // A grant that was replaced some time ago is being presented again.
      //
      // This used to revoke every grant for the editor, on the theory that a
      // late replay means the token was copied. That inference does not hold,
      // and acting on it was worse than the thing it defended against:
      //
      //   - It fires during ordinary use. A tab whose timers were throttled, a
      //     laptop resumed from sleep, a phone off the network — each comes back
      //     holding the token it had, which is now superseded. The user is
      //     signed out on every device, mid-edit, for having left a tab open.
      //   - It is a denial-of-service primitive. The trigger is a single
      //     unauthenticated request carrying a token that is, by construction,
      //     already useless. Anyone who obtains one expired-by-rotation
      //     token — a screenshot, a shared machine, synced storage — can sign an
      //     editor out of everything on demand, repeatedly.
      //   - It buys little even when the inference is right. Rotation has
      //     already made this token worthless: it is refused here, and it cannot
      //     mint a successor. A thief holding the *current* token is unaffected
      //     by the sweep except that they, like the victim, must re-verify — and
      //     they can re-steal.
      //
      // So the response is proportionate to what we actually know: this one
      // token is dead. The holder re-reads the credential their sibling tab
      // wrote and carries on. Lineage-wide revocation still exists and is still
      // the right answer for a *deliberate* trigger — an owner revoking an
      // editor (`revokeSiteEditor`) or an operator acting on the log line
      // below — but it is no longer driven by a signal that fires on its own.
      console.warn(
        `[editor-grants] superseded grant ${row.id} replayed for editor ${row.site_editor_id} ` +
          `(rotated ${Math.round((Date.now() - revokedAt) / 1000)}s ago). Refusing this token only. ` +
          `Repeated occurrences across different devices are worth investigating.`,
      );
      return { valid: false, reason: "replayed" };
    } else {
      return { valid: false, reason: "revoked" };
    }
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { valid: false, reason: "expired" };
  }

  type EditorJoin = {
    id: string;
    site_id: string;
    email: string;
    permissions: string[] | null;
    revoked_at: string | null;
  };
  const editor = row.site_editors as unknown as EditorJoin | null;

  if (!editor) return { valid: false, reason: "unknown" };

  // The immediate-revocation check. Deliberately read fresh on every call rather
  // than trusted from anything cached in the token.
  if (editor.revoked_at) return { valid: false, reason: "editor_revoked" };

  if (editor.site_id !== params.siteId) {
    return { valid: false, reason: "site_mismatch" };
  }

  if (
    !timingSafeEqualString(
      row.user_agent_hash ?? "",
      hashUserAgent(params.device.userAgent),
    )
  ) {
    return { valid: false, reason: "device_mismatch" };
  }

  const expiresAt = new Date(row.expires_at);

  // Best-effort; a failed touch must not deny access.
  const { error: touchError } = await supabase
    .from("editor_device_grants")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);
  if (touchError) {
    console.error(
      "[editor-grants] last_used_at touch failed:",
      touchError.message,
    );
  }

  return {
    valid: true,
    grant: {
      grantId: row.id,
      siteEditorId: editor.id,
      siteId: editor.site_id,
      email: editor.email,
      permissions: normalizePermissions(editor.permissions),
      expiresAt,
      shouldRefresh:
        expiresAt.getTime() - Date.now() <= GRANT_REFRESH_THRESHOLD_MS,
    },
  };
}

/**
 * Exchange a valid grant for a fresh one, superseding the old.
 *
 * Sliding expiry keeps a regular editor signed in without ever issuing a
 * long-lived credential, and rotation means a token captured at any moment has
 * a bounded useful life. The old row stays as `revoked_reason='rotated'`
 * precisely so a later presentation of it is recognisable as a replay.
 */
export async function refreshDeviceGrant(params: {
  grant: string;
  siteId: string;
  device: DeviceContext;
  rememberDevice: boolean;
}): Promise<
  | { ok: true; grant: string; expiresAt: Date }
  | { ok: false; reason: GrantRejection }
> {
  const validation = await validateDeviceGrant({
    grant: params.grant,
    siteId: params.siteId,
    device: params.device,
  });

  if (!validation.valid) return { ok: false, reason: validation.reason };

  const supabase = createServiceRoleClient();

  // Claim the right to rotate BEFORE minting.
  //
  // This conditional update is the serialisation point. Validation is a read,
  // so two tabs refreshing at the same moment both passed it; previously both
  // then minted, and only one won this update. That forked the lineage: one
  // token became two live grants, the loser's replacement was never recorded as
  // superseding anything, and the "was this token replaced?" question that
  // replay detection asks had two answers. Claiming first means exactly one
  // caller proceeds to mint.
  const { data: claimed, error: claimError } = await supabase
    .from("editor_device_grants")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: "rotated",
    })
    .eq("id", validation.grant.grantId)
    .is("revoked_at", null)
    .select("id");

  if (claimError) {
    console.error(
      "[editor-grants] could not claim grant for rotation:",
      claimError.message,
    );
    return { ok: false, reason: "error" };
  }

  if (!claimed || claimed.length === 0) {
    // Lost the race — a sibling refreshed this same token moments ago and has
    // already written the replacement to the shared storage this caller reads.
    // Nothing to do but tell it to pick that up; minting a second grant here is
    // exactly the fork this claim exists to prevent.
    return { ok: false, reason: "raced" };
  }

  const issued = await issueDeviceGrant({
    siteEditorId: validation.grant.siteEditorId,
    siteId: validation.grant.siteId,
    device: params.device,
    rememberDevice: params.rememberDevice,
    rotatedFrom: validation.grant.grantId,
  });

  if (!issued) {
    // Minting failed after the claim succeeded, so the holder is currently
    // holding a token we just marked superseded and has no replacement. Undo the
    // claim rather than leave them locked out of a session they were entitled to
    // keep — the original ordering (mint first) existed for exactly this reason,
    // and this compensating write preserves that guarantee while keeping the
    // serialisation the claim buys us.
    const { error: rollbackError } = await supabase
      .from("editor_device_grants")
      .update({ revoked_at: null, revoked_reason: null })
      .eq("id", validation.grant.grantId)
      .eq("revoked_reason", "rotated");

    if (rollbackError) {
      // Now the holder really is stuck, and silence would make it look like a
      // transient mint failure instead of a revoked credential.
      console.error(
        `[editor-grants] mint failed AND rollback failed for grant ${validation.grant.grantId} — ` +
          `holder must re-verify:`,
        rollbackError.message,
      );
    }

    return { ok: false, reason: "error" };
  }

  return { ok: true, grant: issued.grant, expiresAt: issued.expiresAt };
}

/**
 * Kill every live grant for an editor. Returns the number actually revoked.
 *
 * Deliberate triggers only: an owner removing an editor, or an operator acting
 * on a replay warning. It is no longer wired to replay detection itself — see
 * the long note in `validateDeviceGrant` for why an automatic trigger on that
 * signal was a denial-of-service primitive rather than a defence.
 *
 * The `replay` reason remains available for an operator-initiated sweep in
 * response to that log line; nothing in the request path reaches it.
 */
export async function revokeAllGrantsForEditor(
  siteEditorId: string,
  reason: "editor_revoked" | "replay" | "manual",
): Promise<number> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("editor_device_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("site_editor_id", siteEditorId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    console.error("[editor-grants] revoke sweep failed:", error.message);
    return 0;
  }

  return data?.length ?? 0;
}

/** Revoke one device — "sign out my laptop" from the dashboard. */
export async function revokeGrantById(grantId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("editor_device_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "manual" })
    .eq("id", grantId)
    .is("revoked_at", null);

  if (error) {
    console.error("[editor-grants] revoke failed:", error.message);
    return false;
  }
  return true;
}
