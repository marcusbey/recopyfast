/**
 * POST /api/staging/publish — the seam where "content changed" becomes a
 * webhook (AC 2), and where AC 6 is won or lost.
 *
 * `webhookManager.triggerEvent` existed for months with zero callers anywhere
 * in the app: automatic delivery on content change was not a stub waiting to be
 * wired, it was dead code. This route is the sole application-level choke point
 * for a live content change — `PUT /api/content/[siteId]` explicitly refuses and
 * tells the caller to publish through here.
 *
 * The load-bearing property is that the publisher's response is NOT gated on
 * the webhook work: the marker is recorded inside `after()`, which runs once the
 * response has already been committed. A slow database or a slow endpoint on
 * that side must never show up as a slow "Publish" button (AC 6).
 *
 * Known and deliberate gap: `src/app/api/bulk/import/route.ts` writes
 * `published_content` directly and does not pass through here, so bulk-imported
 * changes do not fire webhooks. That is the plan's stated anchor-point decision,
 * not an oversight.
 */

import { NextRequest, after } from "next/server";

// The repo's global next/server mock (jest.setup.js) predates `after` and does
// not export it. Same shape as the request-code suite: re-declare the mock and
// add `after` as a spy, so a test can hold the deferred callback and prove both
// that it was deferred and what it does when run.
jest.mock("next/server", () => ({
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
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      json: () => Promise.resolve(data),
      status: init?.status || 200,
      headers: new Headers(),
      ok: (init?.status || 200) >= 200 && (init?.status || 200) < 300,
    }),
  },
  after: jest.fn(),
}));

jest.mock("@/lib/http/public-cors", () => ({
  withPublicCors: (response: unknown) => response,
  publicOptions: jest.fn(),
}));

const mockRpc = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: mockRpc })),
}));

jest.mock("@/lib/auth/editor-access", () => ({
  authorizeFirstPartyEditorAccess: jest.fn(),
  requireEditorPermission: jest.fn(() => true),
  validateEditorTokenFromRequest: jest.fn(),
}));

jest.mock("@/lib/webhooks/manager", () => ({
  ...jest.requireActual("@/lib/webhooks/manager"),
  webhookManager: { recordQualifyingEvent: jest.fn() },
}));

import { POST } from "@/app/api/staging/publish/route";
import { authorizeFirstPartyEditorAccess } from "@/lib/auth/editor-access";
import { webhookManager, WEBHOOK_EVENTS } from "@/lib/webhooks/manager";

const mockAfter = after as jest.Mock;
const mockAuthorize = authorizeFirstPartyEditorAccess as jest.Mock;
const mockRecord = webhookManager.recordQualifyingEvent as jest.Mock;

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const PUBLISHED_ROWS = [
  { element_id: "hero-title", content: "New headline" },
  { element_id: "cta", content: "Buy now" },
];

function publishRequest() {
  return new NextRequest("https://www.recopyfa.st/api/staging/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId: SITE_ID }),
  });
}

/** Runs whatever the route handed to `after()`. */
async function runDeferred() {
  for (const [callback] of mockAfter.mock.calls) {
    await callback();
  }
}

describe("POST /api/staging/publish — webhook hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockAuthorize.mockResolvedValue({
      email: "owner@example.com",
      userId: "user-1",
    });
    mockRpc.mockResolvedValue({ data: PUBLISHED_ROWS, error: null });
    mockRecord.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records a content.updated event carrying the published elements", async () => {
    await POST(publishRequest());
    await runDeferred();

    expect(mockRecord).toHaveBeenCalledWith({
      siteId: SITE_ID,
      eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
      payload: { elements: PUBLISHED_ROWS },
    });
  });

  it("does not wait for the webhook work before answering the publisher", async () => {
    const response = await POST(publishRequest());
    const body = (await response.json()) as { success: boolean };

    // The response is fully built and the deferred callback has not run: the
    // two are not serialized, which is what AC 6 actually asks for.
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("publishes nothing and records nothing when the RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("rpc failed") });

    const response = await POST(publishRequest());
    await runDeferred();

    expect(response.status).toBe(500);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("records nothing when the publish changed no elements", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const response = await POST(publishRequest());
    await runDeferred();

    expect(response.status).toBe(200);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("still answers 200 when recording the event throws", async () => {
    mockRecord.mockRejectedValue(new Error("db down"));

    const response = await POST(publishRequest());

    expect(response.status).toBe(200);
    await expect(runDeferred()).resolves.toBeUndefined();
  });
});
