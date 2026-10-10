/**
 * Authorization for the realtime service.
 *
 * This file deliberately duplicates rules that also exist in `src/lib/security/
 * site-auth.ts` and `src/lib/auth/editor-access.ts` rather than importing them.
 * `server/` ships as its own npm package through `server/Dockerfile`, with
 * `server/` as the build context — a `require('../src/…')` would resolve
 * perfectly on a developer's machine and `MODULE_NOT_FOUND` inside the image.
 * The duplication is the price of that boundary; the parity suite in
 * `src/__tests__/websocket/auth-parity.test.ts` is what stops the two copies
 * drifting silently. Since s68c that includes the staging device binding
 * (`src/lib/auth/staging-device.ts`, `src/lib/auth/editor-crypto.ts`).
 */

const crypto = require('crypto');

function normalizeDomain(domain) {
  if (!domain) return null;
  try {
    const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    return url.hostname.toLowerCase();
  } catch (error) {
    return null;
  }
}

function parseHost(header) {
  if (!header) return null;
  try {
    return new URL(header).hostname.toLowerCase();
  } catch (error) {
    return null;
  }
}

/**
 * Verify a site token produced by buildSiteToken() on the HTTP side.
 * Token format: "<siteId>.<issuedAtUnixSeconds>.<hmac-sha256-hex>"
 *
 * Checks performed (matching verifySiteTokenSignature in site-auth.ts):
 *  1. Three-part structure
 *  2. siteId claim matches expected
 *  3. issuedAt is a digit-only unix timestamp
 *  4. Token is not future-dated (allows 60 s clock skew)
 *  5. HMAC signature is valid (timing-safe compare)
 *
 * There is intentionally no age cap. Rotating the site's api_key revokes every
 * token signed by the old key, matching the HTTP verifier and preventing an
 * installed snippet from dying merely because time passed.
 */
function verifySiteToken(siteId, apiKey, token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [tokenSiteId, issuedAtStr, signature] = parts;
  if (tokenSiteId !== siteId) return false;
  if (!/^[0-9]+$/.test(issuedAtStr)) return false;

  const issuedAtSeconds = parseInt(issuedAtStr, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Reject future-dated tokens (allow 60 s of clock skew)
  if (issuedAtSeconds > nowSeconds + 60) return false;

  const expectedSignature = crypto
    .createHmac('sha256', apiKey)
    .update(`${tokenSiteId}.${issuedAtStr}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (error) {
    return false;
  }
}

/**
 * The domain pin is mandatory, not conditional on a header being offered.
 *
 * `data-site-token` ships as a plain attribute in the customer's page markup
 * (src/lib/sites/embed-script.ts:76), so the token is readable with View
 * Source and this check is the only thing that makes a published credential
 * safe. It used to read `if (allowedDomain && requestHost && requestHost !==
 * allowedDomain)`. Origin and Referer are set by browsers and cannot be forged
 * cross-origin — but nothing obliges a non-browser caller to send either, so
 * treating "no header" as "nothing to check" enforced the pin only against
 * the caller that could never have beaten it, and skipped it entirely for
 * curl. A caller that cannot present the registered domain is refused. (A-2)
 *
 * The second truthiness guard was the same mistake in the other direction: a
 * site row whose `domain` is null or unparseable produced no pin at all, so
 * every socket in the world was admitted to it.
 *
 * There is no localhost/demo-token exemption here, unlike site-auth.ts. That
 * exemption exists so a local test page can reach the HTTP API; this transport
 * has no such caller, and an exemption nobody needs is only an attack surface.
 */
function isOriginAllowed(siteDomain, originHeader) {
  const allowedDomain = normalizeDomain(siteDomain);
  if (!allowedDomain) return false;

  const requestHost = parseHost(originHeader);
  if (!requestHost) return false;

  return requestHost === allowedDomain;
}

function normalizePermissions(rawPermissions) {
  const permissions = new Set(Array.isArray(rawPermissions) ? rawPermissions : []);
  if (permissions.has('admin')) {
    permissions.add('publish');
    permissions.add('edit');
    permissions.add('view');
  }
  if (permissions.has('publish')) {
    permissions.add('edit');
    permissions.add('view');
  }
  if (permissions.has('edit')) {
    permissions.add('view');
  }
  return ['view', 'edit', 'publish', 'admin'].filter(permission => permissions.has(permission));
}

/**
 * How long a successful staging verification vouches for a browser.
 * Duplicates STAGING_VERIFICATION_TTL_MS in src/lib/auth/staging-device.ts;
 * the parity suite (auth-parity.test.ts) feeds both copies the same rows.
 */
const STAGING_VERIFICATION_TTL_MS = 12 * 60 * 60 * 1000;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Fingerprint of the browser: the whole User-Agent string, unkeyed.
 * Duplicates `hashUserAgent` in src/lib/auth/editor-crypto.ts byte for byte —
 * it has to, because the value compared against is the one HTTP's
 * `verifyEmail` wrote into `staging_access.verified_user_agent_hash`. A
 * missing User-Agent hashes as an empty one, on both sides (parity rows).
 */
function hashUserAgent(userAgent) {
  return sha256Hex(`ua\u0000${userAgent ?? ''}`).slice(0, 32);
}

/**
 * Constant-time string comparison over fixed-length digests, as
 * `timingSafeEqualString` does in src/lib/auth/editor-crypto.ts:
 * `timingSafeEqual` throws on unequal lengths, which would itself leak length.
 */
function timingSafeEqualString(a, b) {
  const aDigest = crypto.createHash('sha256').update(a, 'utf8').digest();
  const bDigest = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(aDigest, bDigest);
}

/**
 * Does this socket come from the browser that passed verification, recently
 * enough to still be trusted? The server copy of `checkStagingDeviceBinding`
 * (src/lib/auth/staging-device.ts) — same arguments, same verdicts, pinned by
 * the "staging device binding parity" rows in auth-parity.test.ts.
 *
 * TOMBSTONE — M7 (s68c). `resolveStagingGrant` used to stop at
 * `email_verified`, a permanent flag on a row keyed by a token that travels in
 * a URL. HTTP has refused a forwarded link since the forwarded-invite fix; the
 * socket admitted it to `site:{id}:staging`, where it received every editor's
 * unpublished copy. Fails CLOSED on a row with no binding, like HTTP: a row
 * verified before the binding existed is exactly the forwarded case.
 *
 * Same honest limitation as HTTP (staging-device.ts module header): a
 * User-Agent is attacker-supplied, so this stops a forwarded URL opened in
 * someone else's browser, not a client that replays the victim's headers. The
 * 12 h bound is what limits that case.
 */
function checkStagingDeviceBinding(recorded, presented, now = Date.now()) {
  if (!recorded.userAgentHash || !recorded.verifiedAt) {
    return { ok: false, reason: 'unbound' };
  }

  const verifiedAtMs = new Date(recorded.verifiedAt).getTime();
  if (!Number.isFinite(verifiedAtMs)) {
    return { ok: false, reason: 'unbound' };
  }

  if (now - verifiedAtMs > STAGING_VERIFICATION_TTL_MS) {
    return { ok: false, reason: 'stale' };
  }

  if (!timingSafeEqualString(recorded.userAgentHash, presented.userAgentHash)) {
    return { ok: false, reason: 'device_mismatch' };
  }

  return { ok: true };
}

/**
 * Resolve an editor grant from the database. Every time. No caching.
 *
 * M5: the grant used to be resolved once, at the handshake, and cached on
 * `socket.data`; the permission check on every `content-update` read that
 * cache, and nothing ever re-read the row. Revoking an editor therefore had no
 * effect on a connection that was already open — it kept its permissions until
 * the tab closed.
 *
 * A TTL cache would have been the tempting fix and is the wrong one: it makes
 * revocation eventually-consistent by exactly the TTL, and "how long can a
 * removed editor keep working" is not a number anyone wants to have to look up.
 * One indexed SELECT per message is proportionate here because the socket emit
 * follows a completed HTTP PUT (`persistContentUpdate`,
 * recopyfast.src.js:2625) — it is one per save, not one per keystroke — and the
 * rate limiter, not a cache, is what bounds the rate.
 *
 * Three predicates the previous queries omitted, all of them columns that
 * already exist and that the revocation paths already write:
 *   - `revoked_at IS NULL` on the grant row itself. `edit_sessions.revoked_at`
 *     has existed since 20250817000000_complete_database_setup.sql:380 and
 *     neither this file's predecessor nor editor-access.ts:293 consulted it.
 *   - `expires_at > now()`, strictly.
 *   - for a `staging_access` grant carrying an email, the `site_editors` row
 *     for that (site, email). That is the durable allowlist `revokeSiteEditor`
 *     (src/lib/auth/editor-directory.ts:189-193) actually stamps, so an
 *     "remove this editor" action reaches a live socket only through this check.
 */
async function resolveGrant(options) {
  const { supabase, siteId, stagingToken, editToken, userAgent } = options;

  if (!supabase) {
    return { valid: false, error: 'Editor access unavailable' };
  }

  try {
    if (stagingToken) {
      return await resolveStagingGrant(supabase, siteId, stagingToken, { userAgent });
    }
    if (editToken) {
      return await resolveEditSessionGrant(supabase, siteId, editToken);
    }
    return { valid: false, error: 'No editor credential' };
  } catch (error) {
    // Fail closed. A database that cannot answer "is this grant still valid"
    // has not answered "yes".
    console.error('[auth] grant resolution failed:', error.message);
    return { valid: false, error: 'Editor access could not be verified' };
  }
}

async function resolveStagingGrant(supabase, siteId, stagingToken, { userAgent } = {}) {
  const { data: access, error } = await supabase
    .from('staging_access')
    .select('*')
    .eq('token', stagingToken)
    .eq('site_id', siteId)
    .eq('is_active', true)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !access) {
    return { valid: false, error: 'Editor access revoked or expired' };
  }

  if (!access.email_verified) {
    return { valid: false, error: 'Email verification required' };
  }

  // The flag alone is not enough — see checkStagingDeviceBinding. A refusal
  // reads like an unverified row, because that is what HTTP answers it with
  // (`requiresVerification`): the remedy is the same, enter a code again.
  const binding = checkStagingDeviceBinding(
    {
      userAgentHash: access.verified_user_agent_hash ?? null,
      verifiedAt: access.verified_at ?? null,
    },
    { userAgentHash: hashUserAgent(userAgent) },
  );
  if (!binding.ok) {
    return { valid: false, error: 'Email verification required' };
  }

  if (access.email) {
    // Lower-cased, because `site_editors.email` always is (`normalizeEmail`,
    // src/lib/auth/editor-directory.ts) while `staging_access.email` keeps the
    // case the invite form was given. TOMBSTONE — s07a review MAJOR 1, closed
    // in s68c: this compared `access.email` verbatim, so removing
    // `john@example.com` never reached a socket opened as `John@Example.com`.
    const { data: editor, error: editorError } = await supabase
      .from('site_editors')
      .select('revoked_at')
      .eq('site_id', siteId)
      .eq('email', access.email.trim().toLowerCase())
      .maybeSingle();

    // Fail CLOSED, as HTTP's twin does (`isEditorRevoked`,
    // src/lib/auth/staging-access.ts). TOMBSTONE — s68c review MAJOR 1: this
    // destructured `data` alone, so a lookup that FAILED read as "no directory
    // row" — and absent is not revoked. On a partial database failure a removed
    // editor verified from the same browser was admitted to the staging room,
    // or survived the sweep, while every HTTP route refused them. A read that
    // did not answer "was this editor removed" has not answered "no". Pinned by
    // the "both real validators" parity table and the integration cases
    // "…when the directory cannot be read".
    if (editorError) {
      console.error('[auth] site_editors lookup failed:', editorError.message);
      return { valid: false, error: 'Editor access could not be verified' };
    }

    // Absent is not revoked: a staging link can exist without a directory row.
    // Present-and-stamped is.
    if (editor && editor.revoked_at) {
      return { valid: false, error: 'Editor access revoked' };
    }
  }

  return {
    valid: true,
    verified: true,
    email: access.email,
    permissions: normalizePermissions(access.permissions),
    accessId: access.id,
  };
}

/**
 * An edit session's lifetime ceiling, measured from `created_at`, and how far
 * ahead of this clock a `created_at` may sit and still be believed. Duplicates
 * MAX_SESSION_LIFETIME_HOURS (src/lib/auth/edit-sessions.ts) and
 * CREATED_AT_CLOCK_SKEW_MS (src/lib/auth/editor-access.ts); the
 * "edit-session authority parity" rows in auth-parity.test.ts hold them equal.
 */
const MAX_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CREATED_AT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The edit-session principal, under ADR 047: the session row carries NO
 * authority of its own. What it grants is its `permissions` intersected with
 * the holder's LIVE direct `site_permissions` row for this site, read on every
 * resolution (handshake, every `content-update`, every sweep).
 *
 * TOMBSTONE — s68c. This returned `normalizePermissions(session.permissions)`
 * and nothing else, the realtime twin of H1 (s68a fixed the HTTP validator,
 * `validateEditSessionAccess` in editor-access.ts). The socket is
 * broadcast-only, so the cost was disclosure rather than writes: a member who
 * was demoted or removed kept an open socket in `site:{id}:staging`, receiving
 * every editor's unpublished copy, until the session row expired — 2099 for a
 * row written directly. Do not cache the live grant on the socket; a cache is
 * a second copy of the grant, which is the defect.
 *
 * Every refusal — no holder, no live row, past the ceiling, dated in the
 * future, undatable, an empty intersection — answers the same message, so the
 * socket is no oracle for "member removed" versus "token wrong".
 */
async function resolveEditSessionGrant(supabase, siteId, editToken) {
  const refused = { valid: false, error: 'Editor access revoked or expired' };

  const { data: session, error } = await supabase
    .from('edit_sessions')
    .select('*')
    .eq('token', editToken)
    .eq('site_id', siteId)
    .eq('is_active', true)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !session) {
    return refused;
  }

  // Written as "not within", not "beyond", as on HTTP: a `created_at` that is
  // NULL dates to 1970 and one that does not parse makes the age NaN — both
  // must refuse, because a session that cannot be dated cannot be bounded.
  const ageMs = Date.now() - new Date(session.created_at).getTime();
  if (!(ageMs >= -CREATED_AT_CLOCK_SKEW_MS && ageMs <= MAX_SESSION_LIFETIME_MS)) {
    return refused;
  }

  // Checked before the read: `.eq('user_id', null)` is not "no holder", and a
  // team grant (no `user_id`) must never stand in for one.
  if (!session.user_id) {
    return refused;
  }

  const { data: liveGrant, error: grantError } = await supabase
    .from('site_permissions')
    .select('permission')
    .eq('site_id', siteId)
    .eq('user_id', session.user_id)
    .maybeSingle();

  if (grantError || !liveGrant) {
    return refused;
  }

  const livePermissions = normalizePermissions([liveGrant.permission]);
  const permissions = normalizePermissions(session.permissions).filter(
    (permission) => livePermissions.includes(permission)
  );

  if (permissions.length === 0) {
    return refused;
  }

  return {
    valid: true,
    verified: true,
    userId: session.user_id,
    permissions,
    sessionId: session.id,
  };
}

module.exports = {
  checkStagingDeviceBinding,
  hashUserAgent,
  isOriginAllowed,
  normalizeDomain,
  normalizePermissions,
  parseHost,
  resolveGrant,
  verifySiteToken,
};
