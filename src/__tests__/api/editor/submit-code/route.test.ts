/**
 * s39 — `POST /api/editor/submit-code`, hub mode, honours "Remember this browser".
 *
 * The route always read `rememberDevice` off the body, and always threw it away
 * in hub mode: the flag only reached `issueDeviceGrant` on the unlock-in-place
 * path, and the hub cookie was a fixed 30 minutes whatever was ticked. Once
 * `/edit` resumes a live session instead of starting at the code step, that
 * cookie IS the "remember" the editor asked for — so its lifetime, and the flag
 * signed inside it, are what these tests pin.
 *
 * The cookie is read back through `readHubSession`, the same function every
 * later hub request uses, rather than by decoding the token here: a payload the
 * reader would not honour is not a remembered session, whatever it contains.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";

// The global next/server mock (jest.setup.js) returns responses with no
// `cookies` jar, and hub mode's whole output is a `Set-Cookie`. This file
// re-declares the same shape and adds a jar that records what was set, with
// its options, so the lifetime can be asserted rather than assumed.
jest.mock("next/server", () => {
  function makeResponse(data: unknown, init?: { status?: number }) {
    const status = init?.status || 200;
    const jar = new Map<string, { value: string; options: unknown }>();
    return {
      json: () => Promise.resolve(data),
      status,
      headers: new Headers(),
      ok: status >= 200 && status < 300,
      cookies: {
        set: (name: string, value: string, options: unknown) => {
          jar.set(name, { value, options });
        },
        get: (name: string) => jar.get(name),
      },
    };
  }
  return {
    NextRequest: class MockNextRequest {
      url: string;
      nextUrl: URL;
      method: string;
      headers: Headers;
      body?: string;
      constructor(
        url: string,
        init?: { method?: string; headers?: HeadersInit; body?: string },
      ) {
        this.url = url;
        this.nextUrl = new URL(url);
        this.method = init?.method || "GET";
        this.headers = new Headers(init?.headers);
        this.body = init?.body;
      }
      async json() {
        return JSON.parse(this.body || "{}");
      }
    },
    NextResponse: Object.assign(
      (body: unknown, init?: { status?: number }) => makeResponse(body, init),
      { json: makeResponse },
    ),
  };
});

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/auth/editor-directory", () => {
  const actual = jest.requireActual("@/lib/auth/editor-directory");
  return {
    ...actual,
    findActiveSiteEditor: jest.fn(),
    listSitesForEditor: jest.fn(),
  };
});
jest.mock("@/lib/auth/editor-verification");
jest.mock("@/lib/api/rate-limit");

import { POST } from "@/app/api/editor/submit-code/route";
import {
  findActiveSiteEditor,
  listSitesForEditor,
} from "@/lib/auth/editor-directory";
import { consumeVerificationCode } from "@/lib/auth/editor-verification";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  HUB_SESSION_COOKIE,
  readHubSession,
} from "@/lib/auth/editor-hub-session";
import { resetSigningKeyCache } from "@/lib/auth/editor-crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";

const mockListSitesForEditor = listSitesForEditor as jest.MockedFunction<
  typeof listSitesForEditor
>;
const mockConsumeCode = consumeVerificationCode as jest.MockedFunction<
  typeof consumeVerificationCode
>;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

const EMAIL = "bob@example.com";

interface CookieJarResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
  cookies: {
    get: (name: string) => { value: string; options: { maxAge: number } };
  };
}

function hubSubmit(extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/editor/submit-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, code: "123456", ...extra }),
  });
}

async function submit(extra?: Record<string, unknown>) {
  return (await POST(hubSubmit(extra))) as unknown as CookieJarResponse;
}

describe("POST /api/editor/submit-code — hub mode and Remember", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    mockEnforceRateLimit.mockResolvedValue(null);
    mockConsumeCode.mockResolvedValue({ ok: true });
    mockListSitesForEditor.mockResolvedValue([
      {
        siteEditorId: "editor-1",
        siteId: "site-1",
        siteName: "Hello World",
        siteDomain: "helloworld.com",
        permissions: ["view", "edit"],
      },
    ]);
  });

  it("sets a 7-day hub cookie, flagged remembered, when Remember is ticked", async () => {
    const response = await submit({ rememberDevice: true });
    const cookie = response.cookies.get(HUB_SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(cookie.options.maxAge).toBe(604800);
    expect(readHubSession(cookie.value)).toEqual({
      email: EMAIL,
      remembered: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mode: "hub",
      remembered: true,
    });
  });

  it("keeps the 30-minute hub cookie when Remember is not ticked", async () => {
    const response = await submit({ rememberDevice: false });
    const cookie = response.cookies.get(HUB_SESSION_COOKIE);

    expect(cookie.options.maxAge).toBe(1800);
    expect(readHubSession(cookie.value)).toEqual({
      email: EMAIL,
      remembered: false,
    });
    await expect(response.json()).resolves.toMatchObject({
      remembered: false,
    });
  });

  it("treats a missing or non-boolean flag as not ticked", async () => {
    // Only a literal `true` buys the long session — a stringly "true" from a
    // stale or hand-rolled client must not.
    for (const extra of [{}, { rememberDevice: "true" }]) {
      const response = await submit(extra);
      const cookie = response.cookies.get(HUB_SESSION_COOKIE);

      expect(cookie.options.maxAge).toBe(1800);
      expect(readHubSession(cookie.value)?.remembered).toBe(false);
    }
  });

  it("still lists the address's sites alongside the cookie", async () => {
    const response = await submit({ rememberDevice: true });

    await expect(response.json()).resolves.toMatchObject({
      email: EMAIL,
      sites: [
        {
          siteId: "site-1",
          name: "Hello World",
          domain: "helloworld.com",
          permissions: ["view", "edit"],
        },
      ],
    });
  });
});

/**
 * s68b M3. `limitCodeAttempts` keyed the per-address bucket on the raw `siteId`
 * while `consumeVerificationCode` reaches the code row through a `uuid` cast —
 * so each spelling of one site id (upper case, mixed case) was a fresh
 * 5-guesses-per-15-minutes budget against the same 10^6-space code. The id is
 * canonicalised before the limiter; a malformed one is a 400.
 */
describe("POST /api/editor/submit-code — siteId canonicalisation", () => {
  const SITE_ID = "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue(null);
    mockConsumeCode.mockResolvedValue({ ok: false, reason: "mismatch" });
  });

  it("meters and spends an upper-case siteId under its lower-case spelling", async () => {
    const response = await submit({ siteId: SITE_ID.toUpperCase() });

    expect(response.status).toBe(401);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        endpoint: "editor/submit-code:address",
        identifier: `${EMAIL}|${SITE_ID}`,
      }),
    );
    expect(mockConsumeCode).toHaveBeenCalledWith({
      email: EMAIL,
      siteId: SITE_ID,
      code: "123456",
    });
  });

  it("answers 400 invalid_request for a non-UUID siteId, before any limiter or lookup", async () => {
    const response = await submit({ siteId: "site-1" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockConsumeCode).not.toHaveBeenCalled();
  });

  it("leaves hub mode (no siteId) on the hub bucket", async () => {
    await submit();

    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        endpoint: "editor/submit-code:address",
        identifier: `${EMAIL}|hub`,
      }),
    );
    expect(mockConsumeCode).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: null }),
    );
  });
});

describe("POST /api/editor/submit-code — an outage is not an origin verdict (s76)", () => {
  const SITE_ID = "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";

  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    mockEnforceRateLimit.mockResolvedValue(null);
    mockConsumeCode.mockResolvedValue({ ok: true });
    // The `sites` read behind the origin check fails.
    jest.mocked(createServiceRoleClient).mockReturnValue({
      from: () => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: null,
              error: { message: "connection reset" },
            }),
        };
        return chain;
      },
    } as unknown as ReturnType<typeof createServiceRoleClient>);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("answers 503, not 403 origin_mismatch, and mints nothing", async () => {
    // Review minor 2: a failed `sites` read answered "This site isn't served
    // from its registered domain." — a verdict nobody reached.
    const response = (await POST(
      new NextRequest("https://www.recopyfa.st/api/editor/submit-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://helloworld.com",
          "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/120",
        },
        body: JSON.stringify({ email: EMAIL, code: "123456", siteId: SITE_ID }),
      }),
    )) as unknown as CookieJarResponse;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "unavailable",
    });
    expect(findActiveSiteEditor).not.toHaveBeenCalled();
  });
});
