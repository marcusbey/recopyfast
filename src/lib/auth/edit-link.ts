/**
 * The code the owner's "Edit website" link carries (s76, ADR 055).
 *
 * TOMBSTONE — A-29. The link was `https://<domain>?rcf_edit_token=<token>`: the
 * edit session itself, a bearer credential good for up to 24 h with no origin
 * or device binding, in a query string. It reached the customer's access logs
 * and CDN, every `Referer` the page sent before the widget could strip it, and
 * history. Pinned by src/__tests__/api/edit-sessions/create-token-leak.test.ts.
 *
 * Now the link is `https://<host>/#rcf_edit=<code>`:
 *
 *   - in the FRAGMENT, which no browser sends to any server or puts in a
 *     `Referer`;
 *   - a code, not the token: a signed envelope naming one session and one site
 *     that dies 60 seconds after it is minted, and is spent once — by the
 *     widget's boot check, which answers the session's token in a response body
 *     (src/lib/auth/edit-link-redeem.ts, POST /api/staging/validate).
 *
 * This module is the format only: no database, no `@/` imports. Playwright
 * specs import it by relative path to mint a link for a seeded session.
 */

import {
  CRYPTO_DOMAIN,
  decodeSignedToken,
  encodeSignedToken,
} from "./editor-crypto";

/** Long enough for a new tab to load a customer's page; short enough to be inert. */
export const EDIT_LINK_TTL_MS = 60 * 1000;

/** The fragment key: `#rcf_edit=<code>`. The widget reads exactly this. */
export const EDIT_LINK_FRAGMENT_KEY = "rcf_edit";

const EDIT_LINK_PREFIX = "rcfl1";

interface EditLinkPayload {
  /** edit_sessions.id */
  e: string;
  /** the site the session is for */
  s: string;
  /** expiry, epoch seconds */
  x: number;
}

export interface EditLinkClaim {
  sessionId: string;
  siteId: string;
  expiresAt: Date;
}

export function mintEditLinkCode(params: {
  sessionId: string;
  siteId: string;
}): string {
  const payload: EditLinkPayload = {
    e: params.sessionId,
    s: params.siteId,
    x: Math.floor((Date.now() + EDIT_LINK_TTL_MS) / 1000),
  };
  return encodeSignedToken(EDIT_LINK_PREFIX, CRYPTO_DOMAIN.editLink, payload);
}

/**
 * The claim a well-signed code makes, or null. Offline: a forged, edited or
 * cross-purpose code costs no database read. Expiry is NOT checked here — the
 * spender checks it, so it can say "expired" rather than "unknown".
 */
export function readEditLinkCode(
  code: string | null | undefined,
): EditLinkClaim | null {
  const payload = decodeSignedToken<Partial<EditLinkPayload>>(
    EDIT_LINK_PREFIX,
    CRYPTO_DOMAIN.editLink,
    code,
  );
  if (
    !payload ||
    typeof payload.e !== "string" ||
    !payload.e ||
    typeof payload.s !== "string" ||
    !payload.s ||
    typeof payload.x !== "number"
  ) {
    return null;
  }
  return {
    sessionId: payload.e,
    siteId: payload.s,
    expiresAt: new Date(payload.x * 1000),
  };
}

/** A presented edit token that is really a link code, by its prefix alone. */
export function isEditLinkCode(value: string): boolean {
  return value.startsWith(`${EDIT_LINK_PREFIX}.`);
}

/**
 * `<scheme>://<host>[:port]/#rcf_edit=<code>` for a site's registered domain,
 * or null when the domain is not a usable web host.
 *
 * The domain is parsed, not interpolated: `sites.domain` is not normalised on
 * every write, and `https://${domain}` turned a stored `https://example.com`
 * into `https://https://example.com` (A-29's second pin). Path and query of the
 * stored value are dropped; the link always opens the site's root, and carries
 * nothing in its query.
 */
export function buildEditUrl(
  domain: string | null | undefined,
  code: string,
): string | null {
  const trimmed = (domain ?? "").trim();
  if (!trimmed) return null;
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}/#${EDIT_LINK_FRAGMENT_KEY}=${code}`;
  } catch {
    return null;
  }
}
