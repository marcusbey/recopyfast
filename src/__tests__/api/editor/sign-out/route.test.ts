/**
 * s39 — `POST /api/editor/sign-out` ends the hub session server-side.
 *
 * Before s39 "Use a different address" on `/edit` only reset the page's own
 * state. That was harmless while the hub never resumed a session: the cookie
 * was 30 minutes and nothing read it on load. Now `/edit` resumes whatever
 * session the browser holds, for up to 7 days when Remember was ticked — so a
 * client-side reset would put the previous address's site list straight back
 * on screen at the next visit. The cookie is httpOnly, so only the server can
 * clear it; this route is how.
 *
 * It is same-origin only. A cross-site POST here could sign an editor out of
 * the hub behind their back (logout CSRF) — a nuisance rather than a breach,
 * since the route reads and returns nothing — but there is no reason to allow
 * it, and the refusal costs one header comparison.
 */

import { NextRequest } from "next/server";

// Same reason as the submit-code suite: the global next/server mock has no
// cookie jar, and clearing a cookie is this route's entire output.
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
      constructor(
        url: string,
        init?: { method?: string; headers?: HeadersInit },
      ) {
        this.url = url;
        this.nextUrl = new URL(url);
        this.method = init?.method || "GET";
        this.headers = new Headers(init?.headers);
      }
    },
    NextResponse: Object.assign(
      (body: unknown, init?: { status?: number }) => makeResponse(body, init),
      { json: makeResponse },
    ),
  };
});

import * as route from "@/app/api/editor/sign-out/route";
import {
  HUB_SESSION_COOKIE,
  hubSessionCookieOptions,
} from "@/lib/auth/editor-hub-session";

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));

const APP = "https://recopyfast.com";

interface CookieJarResponse {
  status: number;
  headers: Headers;
  json: () => Promise<Record<string, unknown>>;
  cookies: {
    get: (
      name: string,
    ) => { value: string; options: Record<string, unknown> } | undefined;
  };
}

async function signOut(origin?: string): Promise<CookieJarResponse> {
  const request = new NextRequest(`${APP}/api/editor/sign-out`, {
    method: "POST",
    headers: origin === undefined ? {} : { Origin: origin },
  });
  return (await route.POST(request)) as unknown as CookieJarResponse;
}

describe("POST /api/editor/sign-out", () => {
  it("expires the hub cookie with the attributes it was set with", async () => {
    const response = await signOut(APP);
    const cookie = response.cookies.get(HUB_SESSION_COOKIE);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(cookie).toBeDefined();
    expect(cookie!.value).toBe("");

    // A cookie is only replaced by one with the same name, path and domain;
    // anything else sets a second cookie beside the live session.
    expect(cookie!.options).toEqual({
      ...hubSessionCookieOptions(),
      maxAge: 0,
    });
  });

  it("clears the cookie when the browser sends no Origin at all", async () => {
    const response = await signOut(undefined);

    expect(response.status).toBe(200);
    expect(response.cookies.get(HUB_SESSION_COOKIE)?.options.maxAge).toBe(0);
  });

  it.each([["https://evil.example"], ["http://recopyfast.com"], ["null"]])(
    "refuses a POST from %s and leaves the session alone",
    async (origin) => {
      const response = await signOut(origin);

      expect(response.status).toBe(403);
      expect(response.cookies.get(HUB_SESSION_COOKIE)).toBeUndefined();
    },
  );

  it("offers no CORS and no other method", async () => {
    const response = await signOut(APP);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(Object.keys(route).sort()).toEqual(["POST"]);
  });
});
