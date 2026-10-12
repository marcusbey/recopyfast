/**
 * @jest-environment node
 */

/**
 * s96 — POST /api/tools/scan meters and guards an anonymous caller BEFORE it
 * spends anything, in a fixed order, failing closed.
 *
 * Mocked at module boundaries only: the rate-limit STORE (`rateLimiter`), the
 * service client, the report store and the scan itself. `enforceRateLimit`, the
 * same-origin guard, the client key, URL normalisation, the denylist, the
 * catalogue and the registry are real, so what is asserted is the route's
 * actual order of operations.
 */

import { NextRequest } from "next/server";
import { rateLimiter, type RateLimitConfig } from "@/lib/security/rate-limiter";
import { runScan } from "@/lib/tools/scan/run-scan";
import { createReportStore } from "@/lib/tools/report/report-store";
import {
  SCAN_FAILURE_MESSAGES,
  SCAN_MESSAGES,
} from "@/lib/tools/scan/messages";

jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({})),
}));
jest.mock("@/lib/tools/report/report-store", () => {
  const actual = jest.requireActual("@/lib/tools/report/report-store");
  return { __esModule: true, ...actual, createReportStore: jest.fn() };
});
jest.mock("@/lib/tools/scan/run-scan", () => {
  const actual = jest.requireActual("@/lib/tools/scan/run-scan");
  return { __esModule: true, ...actual, runScan: jest.fn() };
});
jest.mock("@/lib/tools/catalogue", () => {
  const actual = jest.requireActual("@/lib/tools/catalogue");
  const calculator = {
    slug: "calculator-fixture",
    name: "Calculator",
    description: "Not a scanner.",
    lens: null,
    cta: null,
  };
  return {
    __esModule: true,
    ...actual,
    getToolEntry: (slug: string) =>
      slug === calculator.slug ? calculator : actual.getToolEntry(slug),
  };
});

import { POST } from "@/app/api/tools/scan/route";

const SITE = "https://www.recopyfa.st";
const REPORT_ID = "6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c";
const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;
const mockedRunScan = runScan as jest.MockedFunction<typeof runScan>;
const mockedCreateStore = createReportStore as jest.MockedFunction<
  typeof createReportStore
>;

const ALLOWED = {
  allowed: true,
  remaining: 1,
  resetTime: Date.now() + 60_000,
  totalRequests: 1,
};
const REFUSED = {
  allowed: false,
  remaining: 0,
  resetTime: Date.now() + 60_000,
  totalRequests: 9,
};

const store = {
  findCachedReportId: jest.fn(),
  insertReport: jest.fn(),
  getReportById: jest.fn(),
};

const REPORT = {
  v: 1 as const,
  tool: "website-spell-checker",
  url: "https://example.com/",
  finalUrl: "https://example.com/",
  scannedAt: "2026-10-11T12:00:00.000Z",
  summary: { headline: "h", verdict: "pass" as const, facts: [] },
  findings: [],
  pages: [{ url: "https://example.com/", status: "checked" as const }],
  truncated: false,
};

function request(
  body: unknown = {
    tool: "website-spell-checker",
    url: "example.com/?token=secret",
  },
  {
    headers = {},
    ip = "203.0.113.7",
    raw,
  }: {
    headers?: Record<string, string>;
    ip?: string | null;
    raw?: BodyInit;
  } = {},
): NextRequest {
  return new NextRequest(`${SITE}/api/tools/scan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });
}

/** The endpoints `checkLimit` was asked about, in order. */
function limiterOrder(): string[] {
  return checkLimit.mock.calls.map(
    ([config]) => (config as RateLimitConfig).endpoint ?? "",
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = SITE;
  delete process.env.TOOLS_SCAN_DISABLED;
  delete process.env.TOOLS_SCAN_GLOBAL_DAILY_CAP;
  delete process.env.TOOLS_SCAN_DENYLIST;
  checkLimit.mockResolvedValue(ALLOWED);
  mockedCreateStore.mockReturnValue(store);
  store.findCachedReportId.mockResolvedValue(null);
  store.insertReport.mockResolvedValue(REPORT_ID);
  mockedRunScan.mockResolvedValue({ ok: true, report: REPORT });
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

async function expectNoCors(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

describe("the same-origin guard, before any store", () => {
  it("refuses a non-JSON body with 415", async () => {
    const response = await POST(
      request(undefined, {
        headers: { "content-type": "text/plain" },
        raw: '{"tool":"x"}',
      }),
    );

    expect(response.status).toBe(415);
    expect(checkLimit).not.toHaveBeenCalled();
    await expectNoCors(response);
  });

  it.each([
    [{ "sec-fetch-site": "cross-site" }],
    [{ "sec-fetch-site": "same-site" }],
    [{ origin: "https://evil.example" }],
    [{ origin: "null" }],
    [{ origin: "https://www.recopyfa.st.evil.example" }],
  ])("refuses %p with 403", async (headers) => {
    const response = await POST(request(undefined, { headers }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: SCAN_MESSAGES.crossSite });
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it.each([[{ "sec-fetch-site": "same-origin", origin: SITE }], [{}]])(
    "lets %p through",
    async (headers) => {
      const response = await POST(request(undefined, { headers }));

      expect(response.status).toBe(200);
    },
  );
});

describe("the client key", () => {
  it("refuses an unidentifiable caller with 403, before any limiter", async () => {
    const response = await POST(request(undefined, { ip: null }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: SCAN_MESSAGES.unidentified,
    });
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it("meters an IPv6 caller by /64, and checks its /48 too", async () => {
    await POST(request(undefined, { ip: "2001:db8:1:2:3:4:5:6" }));

    expect(limiterOrder()).toEqual([
      "tools/scan:burst",
      "tools/scan:daily",
      "tools/scan:daily48",
      "tools/scan:global",
      "tools/scan:target",
    ]);
    const identifiers = checkLimit.mock.calls.map(
      ([config]) => (config as RateLimitConfig).identifier,
    );
    expect(identifiers).toEqual([
      "2001:db8:1:2::/64",
      "2001:db8:1:2::/64",
      "2001:db8:1::/48",
      "all",
      "example.com",
    ]);
  });
});

describe("limiter order and what each refusal spares", () => {
  it("a refused burst answers 429 before the body is read", async () => {
    checkLimit.mockResolvedValueOnce(REFUSED);
    let isBodyRead = false;
    // highWaterMark 0: the stream is pulled only when someone reads it.
    const stream = new ReadableStream(
      {
        pull(controller) {
          isBodyRead = true;
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );

    const response = await POST(
      new NextRequest(`${SITE}/api/tools/scan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.7",
        },
        body: stream,
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      message: SCAN_MESSAGES.burst,
    });
    expect(isBodyRead).toBe(false);
    expect(store.findCachedReportId).not.toHaveBeenCalled();
  });

  it("a rate-limit store outage answers 503 (fail closed)", async () => {
    checkLimit.mockRejectedValueOnce(new Error("redis down"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mockedRunScan).not.toHaveBeenCalled();
  });

  it("a cache hit answers at once and spends no daily, /48, global or target allowance", async () => {
    store.findCachedReportId.mockResolvedValueOnce(REPORT_ID);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reportId: REPORT_ID,
      reportUrl: `/tools/website-spell-checker/r/${REPORT_ID}`,
      cached: true,
    });
    expect(limiterOrder()).toEqual(["tools/scan:burst"]);
    expect(mockedRunScan).not.toHaveBeenCalled();
  });

  it("a miss checks daily, global and target (IPv4: no /48), then scans", async () => {
    await POST(request());

    expect(limiterOrder()).toEqual([
      "tools/scan:burst",
      "tools/scan:daily",
      "tools/scan:global",
      "tools/scan:target",
    ]);
    expect(mockedRunScan).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, "tools/scan:daily", SCAN_MESSAGES.daily],
    [2, "tools/scan:global", SCAN_MESSAGES.globalCap],
    [3, "tools/scan:target", SCAN_MESSAGES.target],
  ])(
    "a refusal at limiter #%i (%s) fetches and stores nothing",
    async (index, endpoint, message) => {
      checkLimit.mockImplementation(async (config) =>
        (config as RateLimitConfig).endpoint === endpoint ? REFUSED : ALLOWED,
      );

      const response = await POST(request());

      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ message });
      expect(limiterOrder()).toHaveLength(index + 1);
      expect(mockedRunScan).not.toHaveBeenCalled();
      expect(store.insertReport).not.toHaveBeenCalled();
    },
  );

  it("logs the global refusal at error, as an operator signal", async () => {
    checkLimit.mockImplementation(async (config) =>
      (config as RateLimitConfig).endpoint === "tools/scan:global"
        ? REFUSED
        : ALLOWED,
    );

    await POST(request());

    expect(console.error).toHaveBeenCalledWith(
      "[tools/scan] global daily scan cap reached",
      { cap: 500 },
    );
  });
});

describe("bad input gets fixed text", () => {
  it.each([
    [
      "malformed JSON",
      request(undefined, { raw: "{not json" }),
      400,
      SCAN_MESSAGES.badBody,
    ],
    [
      "a body over 4 KB",
      request({ tool: "website-spell-checker", url: "a".repeat(4_097) }),
      400,
      SCAN_MESSAGES.badBody,
    ],
    ["an array", request([1, 2]), 400, SCAN_MESSAGES.badBody],
    [
      "a missing url",
      request({ tool: "website-spell-checker" }),
      400,
      SCAN_MESSAGES.badBody,
    ],
    [
      "an unknown tool",
      request({ tool: "constructor", url: "example.com" }),
      400,
      SCAN_MESSAGES.unknownTool,
    ],
    [
      "a tool without a lens",
      request({ tool: "calculator-fixture", url: "example.com" }),
      400,
      SCAN_MESSAGES.notScanTool,
    ],
    [
      "a bad URL",
      request({
        tool: "website-spell-checker",
        url: "javascript:alert(document.cookie)",
      }),
      400,
      SCAN_MESSAGES.invalidUrl,
    ],
  ])("%s → %i", async (_case, req, status, error) => {
    const response = await POST(req);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(mockedRunScan).not.toHaveBeenCalled();
  });

  it("a non-default port is 422 blocked_port", async () => {
    const response = await POST(
      request({
        tool: "website-spell-checker",
        url: "https://example.com:8443/",
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: SCAN_FAILURE_MESSAGES.blocked_port,
      reason: "blocked_port",
    });
  });

  it("a denylisted host (or its subdomain) is 422 denylisted, before the cache", async () => {
    process.env.TOOLS_SCAN_DENYLIST = "example.com";

    const response = await POST(
      request({ tool: "website-spell-checker", url: "www.example.com" }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reason: "denylisted" });
    expect(store.findCachedReportId).not.toHaveBeenCalled();
  });
});

describe("the scan and the row", () => {
  it("scans the normalised URL — query dropped — and stores the report", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reportId: REPORT_ID,
      reportUrl: `/tools/website-spell-checker/r/${REPORT_ID}`,
      cached: false,
    });
    expect(mockedRunScan).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "website-spell-checker",
        url: {
          href: "https://example.com/",
          hostname: "example.com",
          origin: "https://example.com",
        },
      }),
    );
    expect(store.insertReport).toHaveBeenCalledWith({
      tool: "website-spell-checker",
      cacheKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      url: "https://example.com/",
      report: REPORT,
    });
  });

  it.each(["dns", "blocked_address", "robots_disallowed", "timeout"] as const)(
    "a failed scan (%s) is 422 with fixed text, and stores nothing",
    async (reason) => {
      mockedRunScan.mockResolvedValueOnce({ ok: false, reason });

      const response = await POST(request());

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: SCAN_FAILURE_MESSAGES[reason],
        reason,
      });
      expect(store.insertReport).not.toHaveBeenCalled();
    },
  );

  it("an insert error is 503, logged without database text", async () => {
    store.insertReport.mockRejectedValueOnce(new Error("23514 secret detail"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: SCAN_MESSAGES.unavailable });
    expect(
      JSON.stringify((console.error as jest.Mock).mock.calls),
    ).not.toContain("secret detail");
  });

  it("a cache read error is 503", async () => {
    store.findCachedReportId.mockRejectedValueOnce(new Error("down"));

    expect((await POST(request())).status).toBe(503);
  });

  it("logs the host and outcome, never the full URL or the caller's address", async () => {
    await POST(request());

    const logged = JSON.stringify((console.info as jest.Mock).mock.calls);
    expect(logged).toContain('"host":"example.com"');
    expect(logged).toContain('"outcome":"scanned"');
    expect(logged).not.toContain("token=secret");
    expect(logged).not.toContain("203.0.113.7");
  });
});

describe("operator switches", () => {
  it("TOOLS_SCAN_DISABLED=1 answers 503 before anything", async () => {
    process.env.TOOLS_SCAN_DISABLED = "1";

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: SCAN_MESSAGES.disabled });
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 500],
    ["800", 800],
    ["0", 500],
    ["-5", 500],
    ["lots", 500],
    ["1e9", 500],
  ])(
    "TOOLS_SCAN_GLOBAL_DAILY_CAP=%p caps the global bucket at %i",
    async (value, cap) => {
      if (value !== undefined) process.env.TOOLS_SCAN_GLOBAL_DAILY_CAP = value;

      await POST(request());

      const global = checkLimit.mock.calls
        .map(([config]) => config as RateLimitConfig)
        .find((config) => config.endpoint === "tools/scan:global");
      expect(global).toMatchObject({
        identifierType: "global",
        maxRequests: cap,
      });
    },
  );
});
