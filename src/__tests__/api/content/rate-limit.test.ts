/**
 * A-2 — /api/content/[siteId] is metered, and each method declares what happens
 * when the meter itself is down.
 *
 * The credential that opens this route is published in the customer's own page
 * markup (src/lib/sites/embed-script.ts:76), so the limit is part of what bounds
 * the damage a copied token can do — the audit filed "carries no rate limit"
 * alongside the missing Origin pin for that reason.
 *
 * The two methods make opposite calls on a store outage, and both are deliberate:
 *
 *  - POST fails CLOSED. It is the only path that writes content_elements with
 *    the service-role key. Losing Redis must not quietly remove the ceiling on
 *    that, and a refused discovery report is retried by the next visitor's scan.
 *  - GET fails OPEN. It is the read every visitor to the customer's page makes,
 *    and the widget's only fallback is to leave the authored markup in place
 *    (recopyfast.src.js:3293) — so denying here during an outage would
 *    un-publish every customer's copy at once.
 *
 * Only the store is stubbed: `enforceRateLimit`, its header construction and its
 * failure policy are the shipped implementations.
 */

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/content/[siteId]/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { rateLimiter } from "@/lib/security/rate-limiter";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteRequest,
} from "@/lib/security/site-auth";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    __esModule: true,
    ...actual,
    authorizeFirstPartySiteRequest: jest.fn(),
    authorizeSiteRequest: jest.fn(),
    authorizeSiteOrigin: jest.fn(),
  };
});
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

const SITE_ID = "site-123";
const WIDGET_ORIGIN = "https://example.com";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;

type MockServiceClient = {
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  single: jest.Mock;
  upsert: jest.Mock;
};

// Annotated explicitly: the chain methods return the object itself, which
// TypeScript cannot infer from a self-referential initializer (TS7022).
const serviceClient: MockServiceClient = {
  from: jest.fn(() => serviceClient),
  select: jest.fn(() => serviceClient),
  eq: jest.fn(() => serviceClient),
  single: jest.fn(() =>
    Promise.resolve({ data: { id: SITE_ID }, error: null }),
  ),
  upsert: jest.fn(() => Promise.resolve({ error: null })),
};

/** The content query ends on the third `.eq()`; only that one resolves. */
function resolveContentQuery(rows: unknown[]) {
  serviceClient.eq
    .mockReturnValueOnce(serviceClient)
    .mockReturnValueOnce(serviceClient)
    .mockReturnValueOnce(
      Promise.resolve({
        data: rows,
        error: null,
      }) as unknown as typeof serviceClient,
    );
}

function widgetRequest(method: "GET" | "POST") {
  return new NextRequest(`https://recopyfast.com/api/content/${SITE_ID}`, {
    method,
    headers: {
      Authorization: "Bearer site-token",
      Origin: WIDGET_ORIGIN,
      "Content-Type": "application/json",
    },
    body:
      method === "GET"
        ? undefined
        : JSON.stringify({
            "rcf-headline": {
              selector: "h1",
              content: "Discovered copy",
              type: "text",
            },
          }),
  });
}

const params = { params: Promise.resolve({ siteId: SITE_ID }) };

describe("/api/content/[siteId] rate limiting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});

    (
      createServiceRoleClient as jest.MockedFunction<
        typeof createServiceRoleClient
      >
    ).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    serviceClient.from.mockReset();
    serviceClient.from.mockReturnValue(serviceClient);
    serviceClient.select.mockReset();
    serviceClient.select.mockReturnValue(serviceClient);
    serviceClient.eq.mockReset();
    serviceClient.eq.mockReturnValue(serviceClient);
    serviceClient.single.mockReset();
    serviceClient.single.mockResolvedValue({
      data: { id: SITE_ID },
      error: null,
    });
    serviceClient.upsert.mockReset();
    serviceClient.upsert.mockResolvedValue({ error: null });

    (
      authorizeFirstPartySiteRequest as jest.MockedFunction<
        typeof authorizeFirstPartySiteRequest
      >
    ).mockResolvedValue(null);
    (
      authorizeSiteRequest as jest.MockedFunction<typeof authorizeSiteRequest>
    ).mockResolvedValue({
      site: { id: SITE_ID, domain: "example.com", api_key: "api-key" },
      allowedOrigin: WIDGET_ORIGIN,
    });

    checkLimit.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetTime: Date.now() + 60_000,
      totalRequests: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The controls: an allowed request is untouched by any of this, so the
  // refusals below are attributable to the limiter and to nothing else.
  it("serves a read that is within the limit", async () => {
    resolveContentQuery([]);

    const response = await GET(widgetRequest("GET"), params);

    expect(response.status).toBe(200);
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("accepts a discovery report that is within the limit", async () => {
    const response = await POST(widgetRequest("POST"), params);

    expect(response.status).toBe(200);
    expect(serviceClient.upsert).toHaveBeenCalled();
  });

  it("refuses a read over the limit with a 429 the browser can read", async () => {
    checkLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 30_000,
      totalRequests: 201,
    });

    const response = await GET(widgetRequest("GET"), params);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    // Without the CORS header the widget cannot tell a 429 from a dead network,
    // which is the same trap the authorization refusals fell into.
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      WIDGET_ORIGIN,
    );
  });

  it("refuses a discovery write over the limit without touching the table", async () => {
    checkLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 30_000,
      totalRequests: 101,
    });

    const response = await POST(widgetRequest("POST"), params);

    expect(response.status).toBe(429);
    expect(serviceClient.upsert).not.toHaveBeenCalled();
  });

  it("still serves reads when the limiter store is unreachable", async () => {
    resolveContentQuery([]);
    checkLimit.mockRejectedValue(new Error("Redis unreachable"));

    const response = await GET(widgetRequest("GET"), params);

    // Fails open on purpose: an unmetered window on a read costs less than every
    // customer's published copy disappearing for the length of a Redis outage.
    expect(response.status).toBe(200);
  });

  it("refuses discovery writes when the limiter store is unreachable", async () => {
    checkLimit.mockRejectedValue(new Error("Redis unreachable"));

    const response = await POST(widgetRequest("POST"), params);

    // Fails closed on purpose: this is the service-role write path, and the
    // token that reaches it is published in the customer's page.
    expect(response.status).toBe(503);
    expect(serviceClient.upsert).not.toHaveBeenCalled();
  });
});
