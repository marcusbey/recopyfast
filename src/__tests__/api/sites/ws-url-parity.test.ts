/**
 * s07b task 5 — the two-snippet comparison, as a standing test.
 *
 * `NEXT_PUBLIC_WS_URL` is not configuration, it is a build input, and it is
 * read on two different clocks:
 *
 * - **runtime** — `src/app/api/sites/route.ts` and
 *   `src/app/api/sites/register/route.ts` call `buildEmbedScript` inside a
 *   request, so they read whatever the serving environment holds *now*.
 * - **build** — `src/components/dashboard/SiteDetailView.tsx` is a
 *   `"use client"` component and its `buildEmbedScript` fallback runs in the
 *   browser, where Next.js has already inlined the value into the bundle at
 *   build time.
 *
 * So setting the variable without redeploying leaves the API handing out
 * `data-ws-url` while the dashboard shows a snippet without it — or the reverse
 * on rollback. Nobody thinks to compare the two, because each looks right on
 * its own. `server/README.md` records the drill; this file is the part of it
 * that can run in CI.
 *
 * **What this pins:** given one value of `NEXT_PUBLIC_WS_URL`, all three
 * producers emit the *same* `data-ws-url`, and with no value they all omit the
 * attribute rather than emitting it empty — `src/lib/sites/embed-script.ts:92`
 * is explicit that an empty attribute is not "off", it is "on and wrong",
 * because the widget's opt-in check is `if (!window.RECOPYFAST_WS) return`.
 *
 * **What it cannot pin:** whether the deployed build and the deployed runtime
 * were handed the same value. Jest reads `process.env` at call time for all
 * three paths, so the build/runtime split does not exist in here. That half
 * stays a deploy-time check — set the variable, *then* redeploy, then read the
 * dashboard. What this test removes is the other failure: a code change that
 * makes two producers disagree while the deploy was correct.
 */

import { NextRequest } from "next/server";
import { buildEmbedScript } from "@/lib/sites/embed-script";

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({ auth: { getUser: mockGetUser } }),
  ),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}));

// The plan quota and the limiter have their own suites. Here they are open
// doors: the subject is the snippet string, not who is allowed to ask for one.
jest.mock("@/lib/feature-gating/permissions", () => ({
  canCreateWebsite: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

// Pinned so the three snippets are comparable as whole strings: a token is
// HMAC'd from the api_key and a timestamp, so the real one differs per call and
// every producer would legitimately disagree on a field this test is not about.
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return { ...actual, buildSiteToken: jest.fn(() => "signed-site-token") };
});

import { GET } from "@/app/api/sites/route";
import { POST } from "@/app/api/sites/register/route";

const USER_ID = "user-1";
const SITE_ID = "site-1";
const SITE_TOKEN = "signed-site-token";
const APP_URL = "https://www.recopyfa.st";
const WS_URL = "wss://recopyfast-ws.fly.dev";

const SITE_ROW = {
  id: SITE_ID,
  domain: "helloworld.example",
  name: "Hello World",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  api_key: "the-hmac-secret",
};

/** Answers the reads both routes make, by table. */
function siteTables() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "site_permissions") {
      return {
        // GET — the caller owns this site, so it receives install credentials.
        select: () => ({
          eq: async () => ({
            data: [{ site_id: SITE_ID, permission: "admin" }],
            error: null,
          }),
        }),
        // POST — the ownership row written right after the insert.
        upsert: async () => ({ error: null }),
      };
    }

    if (table === "sites") {
      return {
        select: () => ({
          // GET — every site the caller has a permission row for.
          in: async () => ({ data: [SITE_ROW], error: null }),
          // POST — the "is this domain already taken" probe; it is not.
          eq: () => ({ single: async () => ({ data: null, error: null }) }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: SITE_ROW, error: null }),
          }),
        }),
      };
    }

    // content_elements / content_history — counts only, uninteresting here.
    return {
      select: () => ({
        eq: async () => ({ data: [], count: 0, error: null }),
      }),
    };
  });
}

/** The attribute value, or `null` when the attribute is not there at all. */
function wsUrlAttribute(script: string): string | null {
  const match = /\sdata-ws-url="([^"]*)"/.exec(script);
  return match ? match[1] : null;
}

async function snippetFromSitesList(): Promise<string> {
  const response = (await GET(
    new NextRequest(`${APP_URL}/api/sites`),
  )) as unknown as Response;
  const body = await response.json();
  return body.sites[0].embedScript;
}

async function snippetFromRegister(): Promise<string> {
  const response = (await POST(
    new NextRequest(`${APP_URL}/api/sites/register`, {
      method: "POST",
      body: JSON.stringify({
        domain: SITE_ROW.domain,
        name: SITE_ROW.name,
      }),
    }),
  )) as unknown as Response;
  const body = await response.json();
  return body.embedScript;
}

/**
 * The dashboard fallback at `SiteDetailView.tsx:93-98`, called exactly as the
 * component calls it. In the browser this is the build-time reader; here it is
 * the third producer of the same string.
 */
function snippetFromDashboardFallback(): string {
  return buildEmbedScript({ siteId: SITE_ID, siteToken: SITE_TOKEN });
}

async function allThreeSnippets(): Promise<[string, string, string]> {
  return [
    await snippetFromSitesList(),
    await snippetFromRegister(),
    snippetFromDashboardFallback(),
  ];
}

describe("the three snippet producers agree on data-ws-url", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    process.env = { ...originalEnv };
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    siteTables();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("with a websocket origin configured", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_APP_URL = APP_URL;
      process.env.NEXT_PUBLIC_WS_URL = WS_URL;
    });

    // GUARD for the two assertions below. Both compare three strings, and
    // three empty strings compare equal — an undefined `embedScript` from a
    // route that quietly 401'd would read as perfect agreement.
    it("each producer emits a snippet for this site", async () => {
      const snippets = await allThreeSnippets();

      for (const snippet of snippets) {
        expect(snippet).toContain(`data-site-id="${SITE_ID}"`);
        expect(snippet).toContain(`data-api-url="${APP_URL}/api"`);
      }
    });

    it("emits the identical data-ws-url value from all three", async () => {
      const [fromList, fromRegister, fromDashboard] = await allThreeSnippets();

      expect(wsUrlAttribute(fromList)).toBe(WS_URL);
      expect(wsUrlAttribute(fromRegister)).toBe(WS_URL);
      expect(wsUrlAttribute(fromDashboard)).toBe(WS_URL);
    });

    it("produces byte-identical snippets for the same site and token", async () => {
      const [fromList, fromRegister, fromDashboard] = await allThreeSnippets();

      // Stronger than the attribute alone, and deliberately so: the failure
      // this whole task exists to catch is "two snippets that disagree", and
      // any field drifting between producers is that failure.
      expect(fromRegister).toBe(fromList);
      expect(fromDashboard).toBe(fromList);
    });
  });

  describe("with no websocket origin configured", () => {
    beforeEach(() => {
      // A production-shaped app origin: `getPublicWebSocketUrl` derives :4001
      // from localhost:3000 only, and that fallback would mask the omission.
      process.env.NEXT_PUBLIC_APP_URL = APP_URL;
      delete process.env.NEXT_PUBLIC_WS_URL;
    });

    // GUARD, same reason as above: "omits the attribute" must not be able to
    // pass because a producer returned nothing at all.
    it("each producer still emits a usable snippet", async () => {
      const snippets = await allThreeSnippets();

      for (const snippet of snippets) {
        expect(snippet).toContain(`data-site-id="${SITE_ID}"`);
        expect(snippet).toContain(`data-site-token="${SITE_TOKEN}"`);
      }
    });

    it("omits data-ws-url entirely from all three, rather than emitting it empty", async () => {
      const snippets = await allThreeSnippets();

      for (const snippet of snippets) {
        // `data-ws-url=""` is still an attribute, and `RECOPYFAST_WS` set to
        // "" is still falsy — but the widget's early return is the only thing
        // stopping it downloading socket.io, and an attribute is what a future
        // reader copies. Absent, not empty.
        expect(wsUrlAttribute(snippet)).toBeNull();
        expect(snippet).not.toContain("data-ws-url");
      }
    });
  });
});
