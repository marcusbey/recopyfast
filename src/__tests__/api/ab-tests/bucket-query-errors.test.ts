/**
 * `bucket` used to destructure `data` and drop `error` on its read of
 * `visitor_buckets`, and to log-and-continue on the upsert that writes them
 * back. Both failures presented to the widget as a perfectly ordinary 200.
 *
 * That is the worst available outcome, not a cosmetic one. A failed read says
 * "this visitor has no assignments", so every returning visitor is re-bucketed
 * from scratch and the row that was supposed to hold them steady is ignored. A
 * failed write says "assigned", and the next page load re-hashes. Either way
 * traffic keeps being split, events keep being recorded, and the population
 * whose assignment moved is not a random sample of anything.
 *
 * A 500 is the honest answer: the widget's job on failure is to leave the
 * page's own copy alone, not to invent an assignment.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import { createChain, mockServiceClient } from "./support/postgrest-chain";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    __esModule: true,
    ...actual,
    authorizeSiteRequest: jest.fn(),
  };
});

import { GET } from "@/app/api/ab-tests/bucket/[siteId]/route";

const SITE_ID = "site-123";
const TEST_ID = "33333333-3333-3333-3333-333333333333";

const VARIANTS = [
  {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    traffic_percentage: 50,
    is_control: true,
    geo_countries: null,
    geo_regions: null,
  },
  {
    id: "bbbbbbbb-0000-0000-0000-000000000002",
    traffic_percentage: 50,
    is_control: false,
    geo_countries: null,
    geo_regions: null,
  },
];

function request() {
  return GET(
    new NextRequest(
      `https://www.recopyfa.st/api/ab-tests/bucket/${SITE_ID}?token=t&visitor_id=v-1`,
      { headers: { origin: "https://example.com" } },
    ),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  );
}

function activeTestsChain() {
  return createChain({
    result: {
      data: [{ id: TEST_ID, ab_test_variants: VARIANTS }],
      error: null,
    },
  });
}

describe("GET /api/ab-tests/bucket/[siteId] when its own queries fail", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    (
      authorizeSiteRequest as jest.MockedFunction<typeof authorizeSiteRequest>
    ).mockResolvedValue({
      site: { id: SITE_ID, domain: "example.com", api_key: "key" },
      allowedOrigin: "https://example.com",
    });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("refuses rather than reporting an empty assignment set when the read fails", async () => {
    mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
      visitor_buckets: createChain({
        result: { data: null, error: { code: "42P01", message: "no table" } },
      }),
      ab_tests: activeTestsChain(),
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.assignments).toBeUndefined();
  });

  it("logs the detail of a failed read without returning it to the caller", async () => {
    mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
      visitor_buckets: createChain({
        result: {
          data: null,
          error: { code: "42P01", message: "relation does not exist" },
        },
      }),
      ab_tests: activeTestsChain(),
    });

    const body = await (await request()).json();

    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("relation does not exist");
  });

  it("refuses rather than claiming an assignment it failed to persist", async () => {
    mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
      visitor_buckets: createChain({
        result: { data: [], error: null },
        upsert: { error: { code: "42P10", message: "no unique constraint" } },
      }),
      ab_tests: activeTestsChain(),
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.assignments).toBeUndefined();
  });

  it("still answers 200 with the assignment when both queries succeed", async () => {
    mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
      visitor_buckets: createChain({
        result: { data: [], error: null },
        upsert: { error: null },
      }),
      ab_tests: activeTestsChain(),
    });

    const response = await request();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body.assignments)).toEqual([TEST_ID]);
  });
});
