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

export const HUB_SESSION_COOKIE = "rcf_editor_hub";
const HUB_SESSION_PREFIX = "rcfh1";

/** Long enough to pick a site, short enough to be worthless if the laptop walks. */
export const HUB_SESSION_TTL_MS = 30 * 60 * 1000;

interface HubSessionPayload {
  /** verified email */
  e: string;
  /** expiry, epoch seconds */
  x: number;
}

export function createHubSessionToken(email: string): string {
  return encodeSignedToken(HUB_SESSION_PREFIX, CRYPTO_DOMAIN.hubSession, {
    e: normalizeEmail(email),
    x: Math.floor((Date.now() + HUB_SESSION_TTL_MS) / 1000),
  } satisfies HubSessionPayload);
}

export function readHubSessionToken(
  token: string | undefined | null,
): string | null {
  const payload = decodeSignedToken<HubSessionPayload>(
    HUB_SESSION_PREFIX,
    CRYPTO_DOMAIN.hubSession,
    token,
  );

  if (!payload?.e || !payload.x) return null;
  if (payload.x * 1000 <= Date.now()) return null;

  return payload.e;
}

/** The verified email for the current hub request, or null. */
export async function getHubSessionEmail(): Promise<string | null> {
  const store = await cookies();
  return readHubSessionToken(store.get(HUB_SESSION_COOKIE)?.value);
}

/**
 * Cookie attributes.
 *
 * httpOnly so an XSS on the hub cannot read the session; SameSite=Lax so it
 * survives the top-level navigation back from a customer site but is not sent
 * on cross-site subrequests; Secure everywhere except local http development,
 * where the browser would otherwise drop it silently.
 */
export function hubSessionCookieOptions(): {
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
    maxAge: Math.floor(HUB_SESSION_TTL_MS / 1000),
  };
}
