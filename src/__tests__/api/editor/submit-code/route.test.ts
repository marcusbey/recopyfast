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
import { listSitesForEditor } from "@/lib/auth/editor-directory";
import { consumeVerificationCode } from "@/lib/auth/editor-verification";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  HUB_SESSION_COOKIE,
  readHubSession,
} from "@/lib/auth/editor-hub-session";
import { resetSigningKeyCache } from "@/lib/auth/editor-crypto";

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
