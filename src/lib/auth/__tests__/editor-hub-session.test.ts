/**
 * s39 — the hub session carries whether "Remember this browser" was ticked.
 *
 * Until s39 the hub session was 30 minutes, fixed, and the flag the editor
 * ticked at code entry reached the customer's site only through the body of
 * the hand-off request the hub page happened to send. That was survivable
 * while every hub visit started with a code: the checkbox was on screen, and
 * the page could forward it. It stops being survivable the moment `/edit`
 * resumes a live session and skips the code step — the checkbox is never
 * shown, the page's state is the (now unticked) default, and every resumed
 * hand-off would quietly mint a 12-hour grant for someone who asked for 7 days.
 *
 * So the choice is signed into the session itself, and these tests pin the
 * two lifetimes it selects, that neither outlives its expiry, that the flag
 * cannot be forged onto a token, and that a token minted before this change
 * (no `r`) still reads — as not remembered.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import {
  HUB_SESSION_COOKIE,
  HUB_SESSION_TTL_MS,
  createHubSessionToken,
  getHubSession,
  getHubSessionEmail,
  hubSessionCookieOptions,
  readHubSession,
  readHubSessionToken,
} from "../editor-hub-session";
import { REMEMBERED_GRANT_TTL_MS } from "../editor-grants";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  resetSigningKeyCache,
} from "../editor-crypto";
import { cookies } from "next/headers";

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const mockCookies = cookies as unknown as jest.Mock;

const EMAIL = "bob@example.com";
const NOW = new Date("2026-09-25T12:00:00Z").getTime();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Split a signed token into its three dot-separated parts. */
function parts(token: string): [string, string, string] {
  const [prefix, body, signature] = token.split(".");
  return [prefix, body, signature];
}

function decodeBody(body: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

function encodeBody(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("hub session lifetime", () => {
  let now = NOW;

  beforeEach(() => {
    resetSigningKeyCache();
    now = NOW;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lasts 30 minutes when Remember was not ticked", () => {
    const token = createHubSessionToken(EMAIL);

    now = NOW + 29 * MINUTE;
    expect(readHubSession(token)).toEqual({ email: EMAIL, remembered: false });

    now = NOW + 30 * MINUTE + 1000;
    expect(readHubSession(token)).toBeNull();

    expect(hubSessionCookieOptions().maxAge).toBe(30 * 60);
    expect(hubSessionCookieOptions(false).maxAge).toBe(
      HUB_SESSION_TTL_MS / 1000,
    );
  });

  it("lasts 7 days when Remember was ticked — the same 7 days the device grant promises", () => {
    const token = createHubSessionToken(EMAIL, true);

    now = NOW + 6 * DAY;
    expect(readHubSession(token)).toEqual({ email: EMAIL, remembered: true });

    now = NOW + 7 * DAY + 1000;
    expect(readHubSession(token)).toBeNull();

    expect(hubSessionCookieOptions(true).maxAge).toBe(7 * 24 * 60 * 60);
    expect(hubSessionCookieOptions(true).maxAge).toBe(
      REMEMBERED_GRANT_TTL_MS / 1000,
    );
  });

  it("keeps the cookie attributes whatever the lifetime", () => {
    for (const remembered of [false, true]) {
      expect(hubSessionCookieOptions(remembered)).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
  });

  it("normalises the address it signs", () => {
    const token = createHubSessionToken("  Bob@Example.COM ", true);
    expect(readHubSession(token)?.email).toBe(EMAIL);
  });
});

describe("hub session integrity", () => {
  beforeEach(() => {
    resetSigningKeyCache();
  });

  it("refuses a 30-minute token rewritten to claim Remember", () => {
    const [prefix, body, signature] = parts(createHubSessionToken(EMAIL));
    const forged = encodeBody({ ...decodeBody(body), r: 1 });

    expect(readHubSession(`${prefix}.${forged}.${signature}`)).toBeNull();
  });

  it("refuses a token whose expiry was pushed out", () => {
    const [prefix, body, signature] = parts(createHubSessionToken(EMAIL));
    const payload = decodeBody(body);
    const forged = encodeBody({ ...payload, x: Number(payload.x) + 7 * 86400 });

    expect(readHubSession(`${prefix}.${forged}.${signature}`)).toBeNull();
  });

  it("refuses nothing-shaped input", () => {
    expect(readHubSession(undefined)).toBeNull();
    expect(readHubSession(null)).toBeNull();
    expect(readHubSession("")).toBeNull();
    expect(readHubSession("rcfh1.garbage.garbage")).toBeNull();
  });

  it("reads a token minted before s39 (no `r`) as a live, not-remembered session", () => {
    // Exactly the shape every `rcf_editor_hub` cookie in the wild had on the
    // day this shipped. Those are at most 30 minutes old; they must keep
    // working through the deploy and must not be promoted to 7 days.
    const legacy = encodeSignedToken("rcfh1", CRYPTO_DOMAIN.hubSession, {
      e: EMAIL,
      x: Math.floor((Date.now() + 10 * MINUTE) / 1000),
    });

    expect(readHubSession(legacy)).toEqual({ email: EMAIL, remembered: false });
    expect(readHubSessionToken(legacy)).toBe(EMAIL);
  });
});

describe("reading the session off the request", () => {
  beforeEach(() => {
    resetSigningKeyCache();
    mockCookies.mockReset();
  });

  function withCookie(value: string | undefined) {
    mockCookies.mockResolvedValue({
      get: (name: string) =>
        name === HUB_SESSION_COOKIE && value !== undefined
          ? { name, value }
          : undefined,
    });
  }

  it("returns the address and the flag from the hub cookie", async () => {
    withCookie(createHubSessionToken(EMAIL, true));

    await expect(getHubSession()).resolves.toEqual({
      email: EMAIL,
      remembered: true,
    });
    await expect(getHubSessionEmail()).resolves.toBe(EMAIL);
  });

  it("returns null without a cookie", async () => {
    withCookie(undefined);

    await expect(getHubSession()).resolves.toBeNull();
    await expect(getHubSessionEmail()).resolves.toBeNull();
  });
});
