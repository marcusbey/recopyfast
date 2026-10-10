/**
 * s77 (s69 L4) — `CRON_SECRET` is compared in constant time, through one helper.
 *
 * The three cron routes and the blog generator's server-to-server path compared
 * `Authorization` against `Bearer ${CRON_SECRET}` with `!==` / `===`, which
 * returns at the first differing byte. Every other secret in this codebase goes
 * through `crypto.timingSafeEqual`; this was the one that did not.
 *
 * The routes' 401/200 behaviour is the same under either comparison, so the
 * route rows also assert the decision consulted `crypto.timingSafeEqual` — the
 * only observable difference, and the one a revert to `!==` removes.
 */

import crypto from "crypto";
import { NextRequest } from "next/server";
import { webhookManager } from "@/lib/webhooks/manager";
import { isAuthorizedCronRequest } from "@/lib/security/cron-auth";

jest.mock("@/lib/webhooks/manager", () => ({
  ...jest.requireActual("@/lib/webhooks/manager"),
  webhookManager: {
    sweepDueDispatches: jest.fn(),
    sweepDueRetries: jest.fn(),
  },
}));

jest.mock("@/lib/ab-testing/lifecycle", () => ({
  checkTestCompletion: jest.fn(),
}));

// No active tests: an authorised lifecycle tick does one read and answers 200.
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  })),
}));

// The blog generator's second path (a signed-in admin): nobody is signed in.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: null }, error: null }),
        ),
      },
    }),
  ),
}));

import { GET as abTestLifecycle } from "@/app/api/cron/ab-test-lifecycle/route";
import { GET as generateBlogPostCron } from "@/app/api/cron/generate-blog-post/route";
import { GET as webhookDispatch } from "@/app/api/cron/webhook-dispatch/route";
import { POST as generateBlogPost } from "@/app/api/blog/generate/route";

const SECRET = "cron-secret-0123456789";
const manager = webhookManager as jest.Mocked<typeof webhookManager>;
const mockFetch = jest.fn();

function request(
  path: string,
  authorization: string | undefined,
  method = "GET",
): NextRequest {
  return new NextRequest(`https://www.recopyfa.st${path}`, {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify({ topic: "Topic" }) } : {}),
  });
}

/**
 * Each route, called the way its caller calls it. An authorised call goes past
 * the gate: the lifecycle and dispatch ticks answer 200, the two blog paths
 * reach their outbound `fetch` (stubbed to fail, so they answer 500 — anything
 * but 401 means the gate opened).
 */
const ROUTES: Array<{
  name: string;
  call: (authorization?: string) => Promise<Response>;
}> = [
  {
    name: "GET /api/cron/ab-test-lifecycle",
    call: (authorization) =>
      abTestLifecycle(request("/api/cron/ab-test-lifecycle", authorization)),
  },
  {
    name: "GET /api/cron/generate-blog-post",
    call: (authorization) =>
      generateBlogPostCron(
        request("/api/cron/generate-blog-post", authorization),
      ),
  },
  {
    name: "GET /api/cron/webhook-dispatch",
    call: (authorization) =>
      webhookDispatch(request("/api/cron/webhook-dispatch", authorization)),
  },
  {
    name: "POST /api/blog/generate",
    call: (authorization) =>
      generateBlogPost(request("/api/blog/generate", authorization, "POST")),
  },
];

describe("cron routes compare CRON_SECRET in constant time", () => {
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    process.env.CRON_SECRET = SECRET;
    manager.sweepDueDispatches.mockResolvedValue({ dispatched: 0 });
    manager.sweepDueRetries.mockResolvedValue({ retried: 0 });
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.CRON_SECRET = originalSecret;
    global.fetch = originalFetch;
  });

  describe.each(ROUTES)("$name", ({ call }) => {
    it("refuses a wrong secret of the same length, and decides it in constant time", async () => {
      const spy = jest.spyOn(crypto, "timingSafeEqual");
      const wrong = `Bearer ${"x".repeat(SECRET.length)}`;

      const response = await call(wrong);

      expect(response.status).toBe(401);
      expect(spy).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(manager.sweepDueDispatches).not.toHaveBeenCalled();
    });

    it("refuses a missing header and an unset secret", async () => {
      expect((await call()).status).toBe(401);

      delete process.env.CRON_SECRET;
      expect((await call(`Bearer ${SECRET}`)).status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("opens the gate for the configured secret", async () => {
      const spy = jest.spyOn(crypto, "timingSafeEqual");

      const response = await call(`Bearer ${SECRET}`);

      expect(response.status).not.toBe(401);
      expect(spy).toHaveBeenCalled();
    });
  });
});

describe("isAuthorizedCronRequest", () => {
  const originalSecret = process.env.CRON_SECRET;

  function headers(authorization?: string) {
    return {
      headers: new Headers(authorization ? { authorization } : {}),
    };
  }

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.CRON_SECRET = originalSecret;
  });

  it("accepts exactly `Bearer <CRON_SECRET>`", () => {
    expect(isAuthorizedCronRequest(headers(`Bearer ${SECRET}`))).toBe(true);
  });

  it.each([
    [
      "a wrong secret of the same length",
      `Bearer ${"x".repeat(SECRET.length)}`,
    ],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the secret with a suffix", `Bearer ${SECRET}x`],
    ["the bare secret", SECRET],
    ["another scheme", `Basic ${SECRET}`],
    ["an empty header", ""],
  ])("refuses %s without throwing", (_label, authorization) => {
    expect(() =>
      isAuthorizedCronRequest(headers(authorization || undefined)),
    ).not.toThrow();
    expect(isAuthorizedCronRequest(headers(authorization || undefined))).toBe(
      false,
    );
  });

  it("refuses everything when the secret is unset or empty — fail closed", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(headers("Bearer undefined"))).toBe(false);
    expect(isAuthorizedCronRequest(headers("Bearer "))).toBe(false);

    process.env.CRON_SECRET = "";
    expect(isAuthorizedCronRequest(headers("Bearer "))).toBe(false);
  });

  it("compares two equal-length buffers with crypto.timingSafeEqual, whatever the presented length", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");

    isAuthorizedCronRequest(headers("Bearer short"));
    isAuthorizedCronRequest(headers(`Bearer ${SECRET}${"x".repeat(100)}`));

    expect(spy).toHaveBeenCalledTimes(2);
    for (const [left, right] of spy.mock.calls) {
      expect((left as Buffer).length).toBe((right as Buffer).length);
    }
  });
});
