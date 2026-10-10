/**
 * The hub session — proof, on recopyfast.com only, that this browser recently
 * entered a code for a given address.
 *
 * Stateless on purpose. It grants nothing by itself: the only things it can do
 * are list the sites that address may edit and mint a handoff, and both of those
 * re-read `site_editors` at the moment of use. So there is no window in which a
 * stale hub session lets someone onto a site they were just removed from, and
 * therefore no need for a revocable server-side session record.
 */

import { cookies } from "next/headers";
import {
  CRYPTO_DOMAIN,
  decodeSignedToken,
  encodeSignedToken,
} from "@/lib/auth/editor-crypto";
import { normalizeEmail } from "@/lib/auth/editor-directory";
import { REMEMBERED_GRANT_TTL_MS } from "@/lib/auth/editor-grants";

export const HUB_SESSION_COOKIE = "rcf_editor_hub";
const HUB_SESSION_PREFIX = "rcfh1";

/** Long enough to pick a site, short enough to be worthless if the laptop walks. */
export const HUB_SESSION_TTL_MS = 30 * 60 * 1000;

interface HubSessionPayload {
  /** verified email */
  e: string;
  /** expiry, epoch seconds */
  x: number;
  /** present (1) only when "Remember this browser" was ticked at code entry */
  r?: 1;
}

export interface HubSession {
  email: string;
  remembered: boolean;
}

/**
 * The lifetime "Remember this browser" buys on the hub.
 *
 * s39: the hub used to be a 30-minute, one-way door — enter a code, pick a
 * site, never come back — so the checkbox only ever shaped the device grant
 * minted on the customer's site. Once the editor bar grew an "All sites"
 * control, the hub became somewhere a remembered editor returns to, and a
 * 30-minute session there meant a fresh emailed code on every return inside a
 * week they had been promised. The remembered lifetime is the device grant's
 * own constant, imported rather than restated, so the two "remember" promises
 * the same checkbox makes cannot drift apart.
 *
 * Seven days is safe here for the reason the file header gives: this session
 * can only list sites and mint hand-offs, and both re-read `site_editors` at
 * the moment of use, so removing an editor still takes effect immediately.
 */
function hubSessionTtlMs(remembered: boolean): number {
  return remembered ? REMEMBERED_GRANT_TTL_MS : HUB_SESSION_TTL_MS;
}

/**
 * The remembered flag is signed INTO the session, not left to the hub page.
 *
 * It used to reach the site only through the body of the hand-off request,
 * which was fine while every hub visit started at the code step with the
 * checkbox on screen. A resumed session (s39) skips that step, so the page no
 * longer knows what was ticked — and defaulting would silently hand a 12-hour
 * grant to someone who asked for 7 days. The flag is omitted, not written as
 * 0, when unticked, so an unremembered token is byte-for-byte the pre-s39 shape.
 */
export function createHubSessionToken(
  email: string,
  remembered = false,
): string {
  const payload: HubSessionPayload = {
    e: normalizeEmail(email),
    x: Math.floor((Date.now() + hubSessionTtlMs(remembered)) / 1000),
    ...(remembered ? { r: 1 as const } : {}),
  };
  return encodeSignedToken(
    HUB_SESSION_PREFIX,
    CRYPTO_DOMAIN.hubSession,
    payload,
  );
}

/**
 * Verify a hub token and read what it carries. A token minted before s39 has
 * no `r` and reads as not remembered — those are at most 30 minutes old and
 * must not be promoted to 7 days by a deploy.
 */
export function readHubSession(
  token: string | undefined | null,
): HubSession | null {
  const payload = decodeSignedToken<HubSessionPayload>(
    HUB_SESSION_PREFIX,
    CRYPTO_DOMAIN.hubSession,
    token,
  );

  if (!payload?.e || !payload.x) return null;
  if (payload.x * 1000 <= Date.now()) return null;

  return { email: payload.e, remembered: payload.r === 1 };
}

export function readHubSessionToken(
  token: string | undefined | null,
): string | null {
  return readHubSession(token)?.email ?? null;
}

/** The hub session for the current request, or null. */
export async function getHubSession(): Promise<HubSession | null> {
  const store = await cookies();
  return readHubSession(store.get(HUB_SESSION_COOKIE)?.value);
}

/** The verified email for the current hub request, or null. */
export async function getHubSessionEmail(): Promise<string | null> {
  return (await getHubSession())?.email ?? null;
}

/**
 * Cookie attributes.
 *
 * httpOnly so an XSS on the hub cannot read the session; SameSite=Lax so it
 * survives the top-level navigation back from a customer site but is not sent
 * on cross-site subrequests; Secure everywhere except local http development,
 * where the browser would otherwise drop it silently. `maxAge` follows the same
 * lifetime as the signed expiry, so the browser forgets the cookie when the
 * server would refuse it anyway.
 */
export function hubSessionCookieOptions(remembered = false): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(hubSessionTtlMs(remembered) / 1000),
  };
}
