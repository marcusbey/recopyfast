/**
 * Routing gate: signing up does not make an account usable, paying does.
 *
 * `next/server` is stubbed locally rather than used for real. The global stub
 * in jest.setup.js has no `redirect`/`next`, and the real module cannot be
 * loaded under jsdom — NextRequest defines `url` as a getter while the
 * whatwg-fetch Request polyfill assigns to it. This stub records which of the
 * two responses the middleware asked for and with what URL, which is the whole
 * of what this file is about.
 */

interface StubCookie {
  name: string;
  value: string;
}

/** Cookies already on the response when the redirect is built. */
const carriedCookies: StubCookie[] = [];
const redirectCookieSet = jest.fn();

const mockNextResponse = {
  next: jest.fn((_init?: unknown) => ({
    headers: new Headers(),
    cookies: {
      set: jest.fn(),
      getAll: () => carriedCookies,
    },
  })),
  redirect: jest.fn((url: URL | string) => ({
    redirectedTo: new URL(url.toString()),
    headers: new Headers(),
    cookies: { set: redirectCookieSet },
  })),
};

// Indirected through arrow functions so the stub is only dereferenced when the
// middleware calls it, not while jest is hoisting this factory above the const.
jest.mock("next/server", () => ({
  NextResponse: {
    next: (init?: unknown) => mockNextResponse.next(init),
    redirect: (url: URL | string) => mockNextResponse.redirect(url),
  },
}));

const getUser = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser } })),
}));

jest.mock("@/lib/billing/effective-plan", () => ({
  readEffectivePlanId: jest.fn(),
}));

import type { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { readEffectivePlanId } from "@/lib/billing/effective-plan";

const asMock = (fn: unknown) => fn as jest.Mock;

/**
 * The middleware reads `nextUrl` (cloning it to build redirects) and the
 * request cookies. Nothing else, so nothing else is stubbed.
 */
function nextUrl(path: string): URL & { clone: () => URL } {
  const url = new URL(path, "https://app.test") as URL & { clone: () => URL };
  // NextURL's own addition on top of URL, and the only one the middleware uses.
  url.clone = () => nextUrl(url.toString());
  return url;
}

function request(path: string): NextRequest {
  const url = nextUrl(path);
  return {
    url: url.toString(),
    nextUrl: url,
    cookies: { getAll: () => [], set: jest.fn() },
  } as unknown as NextRequest;
}

type Outcome = Awaited<ReturnType<typeof middleware>> & {
  redirectedTo?: URL;
};

async function run(path: string): Promise<Outcome> {
  return (await middleware(request(path))) as Outcome;
}

beforeEach(() => {
  jest.clearAllMocks();
  carriedCookies.length = 0;
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  asMock(readEffectivePlanId).mockResolvedValue("pro");
});

describe("an authenticated session with no plan", () => {
  beforeEach(() => {
    asMock(readEffectivePlanId).mockResolvedValue(null);
  });

  it.each([
    "/dashboard",
    "/dashboard/sites",
    "/dashboard/ab-tests",
    "/settings",
  ])("cannot reach %s by typing the URL", async (path) => {
    const response = await run(path);

    expect(response.redirectedTo?.pathname).toBe("/dashboard/billing");
    expect(response.redirectedTo?.searchParams.get("checkout")).toBe(
      "required",
    );
    expect(response.redirectedTo?.searchParams.get("redirectedFrom")).toBe(
      path,
    );
  });

  it.each([
    ["the checkout page itself", "/dashboard/billing"],
    ["a successful return from Stripe", "/dashboard/billing?checkout=success"],
    ["an abandoned checkout", "/dashboard/billing?checkout=cancelled"],
  ])("is still let through to %s", async (_label, path) => {
    // The webhook has usually not landed at the moment a customer returns from
    // a successful payment, so they are still unentitled here. Redirecting
    // would bounce them off their own receipt and lose the session_id.
    const response = await run(path);

    expect(response.redirectedTo).toBeUndefined();
    expect(mockNextResponse.redirect).not.toHaveBeenCalled();
  });

  it("carries a refreshed session cookie onto the redirect", async () => {
    // getUser() can rotate the token. Dropping the new cookie here would sign
    // the user out on the way to being asked to pay.
    carriedCookies.push({ name: "sb-access-token", value: "refreshed" });

    await run("/dashboard");

    expect(redirectCookieSet).toHaveBeenCalledWith({
      name: "sb-access-token",
      value: "refreshed",
    });
  });

  it("does not gate a public page", async () => {
    const response = await run("/pricing");

    expect(response.redirectedTo).toBeUndefined();
  });

  it("does not spend a query on an API route", async () => {
    await run("/api/sites/register");

    expect(readEffectivePlanId).not.toHaveBeenCalled();
  });
});

describe("an authenticated session with a plan", () => {
  it("reaches the dashboard", async () => {
    const response = await run("/dashboard");

    expect(response.redirectedTo).toBeUndefined();
  });

  it("is let through when the entitlement read fails", async () => {
    // Failing open. A Supabase blip must not lock a paying customer out of
    // their own dashboard, and every API route gates itself regardless.
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    asMock(readEffectivePlanId).mockRejectedValue(new Error("boom"));

    const response = await run("/dashboard");

    expect(response.redirectedTo).toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("an anonymous visitor", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it("is sent to log in, not to checkout", async () => {
    const response = await run("/dashboard");

    expect(response.redirectedTo?.pathname).toBe("/login");
    expect(response.redirectedTo?.searchParams.get("redirectedFrom")).toBe(
      "/dashboard",
    );
    expect(readEffectivePlanId).not.toHaveBeenCalled();
  });
});
