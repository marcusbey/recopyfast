/**
 * A-2 — /api/content/[siteId] is metered, and each method declares what happens
 * when the meter itself is down.
 *
 * The credential that opens this route is published in the customer's own page
 * markup (src/lib/sites/embed-script.ts:76), so the limit is part of what bounds
 * the damage a copied token can do — the audit filed "carries no rate limit"
 * alongside the missing Origin pin for that reason.
 *
 * TWO LIMITERS, DIFFERENT JOBS. Every method meters per client IP BEFORE it looks
 * at credentials, because every method does database work to decide who the caller
 * is — the `sites` lookup, and a Supabase session check on GET. A limiter behind
 * that work cannot protect it. POST then meters a second time, per site, behind
 * authorization, because that is the path that writes with the service-role key.
 * Neither replaces the other: the first sheds anonymous floods, the second caps
 * what a caller holding a published token can write.
 *
 * The two also make opposite calls on a store outage, and both are deliberate:
 *
 *  - The per-site POST limiter fails CLOSED. Losing Redis must not quietly remove
 *    the ceiling on service-role writes, and a refused discovery report is retried
 *    by the next visitor's scan.
 *  - The per-IP limiter fails OPEN. It sits in front of every legitimate widget
 *    request, and the widget's only fallback is to leave the authored markup in
 *    place (recopyfast.src.js:3293) — so denying here during an outage would
 *    un-publish every customer's copy at once. The fail-closed limiter behind it
 *    still bounds the write.
 *
 * Only the store is stubbed: `enforceRateLimit`, its header construction and its
 * failure policy are the shipped implementations.
 */

import { NextRequest } from "next/server";
import { GET, OPTIONS, POST, PUT } from "@/app/api/content/[siteId]/route";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { rateLimiter } from "@/lib/security/rate-limiter";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteOrigin,
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

type Method = "GET" | "POST" | "PUT" | "OPTIONS";

function widgetRequest(method: Method) {
  return new NextRequest(`https://recopyfast.com/api/content/${SITE_ID}`, {
    method,
    headers: {
      Authorization: "Bearer site-token",
      Origin: WIDGET_ORIGIN,
      "Content-Type": "application/json",
    },
    body:
      method === "GET" || method === "OPTIONS"
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

  it("refuses a read over the limit, before it knows whose read it is", async () => {
    checkLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 30_000,
      totalRequests: 201,
    });

    const response = await GET(widgetRequest("GET"), params);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).not.toBeNull();
    // No CORS grant, deliberately: the limiter runs before the site is looked up,
    // so there is no origin this route has agreed to echo yet. The widget cannot
    // read the body — it lands in the same `.catch` as any blocked fetch and keeps
    // the authored copy, which is what it would do with a readable 429 anyway.
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
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

  /**
   * The limiter has to run in front of the work, not behind it.
   *
   * Every method does database work to decide who the caller is — the `sites`
   * lookup in `authorizeSiteRequest`/`authorizeSiteOrigin`, and a Supabase session
   * check on GET. Metering after that meant a caller holding no credential at all
   * could drive those round trips at whatever rate it liked, because the limiter it
   * would have tripped sat behind them.
   */
  describe("sheds load before spending anything on authorization", () => {
    beforeEach(() => {
      checkLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30_000,
        totalRequests: 201,
      });
    });

    it.each([
      ["GET", () => GET(widgetRequest("GET"), params)],
      ["POST", () => POST(widgetRequest("POST"), params)],
      ["PUT", () => PUT(widgetRequest("PUT"), params)],
      ["OPTIONS", () => OPTIONS(widgetRequest("OPTIONS"), params)],
    ] as const)(
      "%s answers 429 without authorizing or reaching the database",
      async (_method, call) => {
        const response = await call();

        expect(response.status).toBe(429);
        expect(authorizeFirstPartySiteRequest).not.toHaveBeenCalled();
        expect(authorizeSiteRequest).not.toHaveBeenCalled();
        expect(authorizeSiteOrigin).not.toHaveBeenCalled();
        expect(serviceClient.from).not.toHaveBeenCalled();
      },
    );

    it("buckets that limiter by IP, never by site", async () => {
      // Per site, an anonymous flood would spend the customer's own discovery
      // budget and lock their widget out — a worse denial of service than the one
      // being closed.
      await POST(widgetRequest("POST"), params);

      const config = checkLimit.mock.calls[0][0];
      expect(config.identifierType).toBe("ip");
      expect(config.identifier).not.toBe(SITE_ID);
    });
  });

  it("meters the write path twice: per IP in front, per site behind", async () => {
    // The per-IP limiter admits the request; the per-site one refuses it. Two
    // buckets, two jobs — neither is a substitute for the other.
    checkLimit
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 199,
        resetTime: Date.now() + 60_000,
        totalRequests: 1,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30_000,
        totalRequests: 101,
      });

    const response = await POST(widgetRequest("POST"), params);

    expect(checkLimit).toHaveBeenCalledTimes(2);
    expect(checkLimit.mock.calls[0][0].identifierType).toBe("ip");
    expect(checkLimit.mock.calls[1][0].identifier).toBe(SITE_ID);
    expect(response.status).toBe(429);
    expect(serviceClient.upsert).not.toHaveBeenCalled();
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
