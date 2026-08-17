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
 * drifting silently.
 */

const crypto = require('crypto');

/** Maximum token lifetime: 90 days in seconds (mirrors site-auth.ts). */
const SITE_TOKEN_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

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
 *  4. Token is not older than 90 days
 *  5. Token is not future-dated (allows 60 s clock skew)
 *  6. HMAC signature is valid (timing-safe compare)
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

  // Reject tokens older than 90 days
  if (nowSeconds - issuedAtSeconds > SITE_TOKEN_MAX_AGE_SECONDS) return false;

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
  const { supabase, siteId, stagingToken, editToken } = options;

  if (!supabase) {
    return { valid: false, error: 'Editor access unavailable' };
  }

  try {
    if (stagingToken) {
      return await resolveStagingGrant(supabase, siteId, stagingToken);
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

async function resolveStagingGrant(supabase, siteId, stagingToken) {
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

  if (access.email) {
    const { data: editor } = await supabase
      .from('site_editors')
      .select('revoked_at')
      .eq('site_id', siteId)
      .eq('email', access.email)
      .maybeSingle();

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

async function resolveEditSessionGrant(supabase, siteId, editToken) {
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
    return { valid: false, error: 'Editor access revoked or expired' };
  }

  return {
    valid: true,
    verified: true,
    userId: session.user_id,
    permissions: normalizePermissions(session.permissions),
    sessionId: session.id,
  };
}

module.exports = {
  SITE_TOKEN_MAX_AGE_SECONDS,
  isOriginAllowed,
  normalizeDomain,
  normalizePermissions,
  parseHost,
  resolveGrant,
  verifySiteToken,
};
