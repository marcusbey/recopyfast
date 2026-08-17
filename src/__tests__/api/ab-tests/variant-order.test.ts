/**
 * A/B assignment maps a hash onto a variant by walking the variant list and
 * accumulating `traffic_percentage`. The walk's answer depends entirely on the
 * order of that list, and until now nothing fixed it: neither
 * `active/[siteId]` nor `bucket/[siteId]` put an ORDER BY on the embedded
 * `ab_test_variants` select, and Postgres promises no order without one.
 *
 * The failure is silent by construction. The planner changes its mind — a new
 * index, a vacuum, a different row count — the variant list comes back in a
 * different order, and a returning visitor is quietly reassigned. No error, no
 * log line, no support ticket; just a test whose numbers are the average of two
 * different experiments.
 *
 * So the order is pinned twice, deliberately: on the wire (`.order(...)`, so
 * the payload the widget receives is stable) and in the bucketing function
 * itself (so the answer does not depend on Postgres honouring anything).
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import {
  createChain,
  mockServiceClient,
  type TableChain,
} from "./support/postgrest-chain";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    __esModule: true,
    ...actual,
    authorizeSiteRequest: jest.fn(),
  };
});

import { GET as getActive } from "@/app/api/ab-tests/active/[siteId]/route";
import { GET as getBucket } from "@/app/api/ab-tests/bucket/[siteId]/route";

const SITE_ID = "site-123";
const TEST_ID = "33333333-3333-3333-3333-333333333333";
const CONTROL_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const VARIANT_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const VARIANT_C_ID = "cccccccc-0000-0000-0000-000000000003";

function mockTables(tables: Record<string, TableChain>) {
  return mockServiceClient(
    createServiceRoleClient as unknown as jest.Mock,
    tables,
  );
}

function variant(id: string, isControl: boolean, traffic: number) {
  return {
    id,
    name: id,
    variant_content: `content ${id}`,
    traffic_percentage: traffic,
    is_control: isControl,
    geo_countries: null,
    geo_regions: null,
  };
}

function activeRequest() {
  return getActive(
    new NextRequest(
      `https://www.recopyfa.st/api/ab-tests/active/${SITE_ID}?token=t`,
      { headers: { origin: "https://example.com" } },
    ),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  );
}

function bucketRequest(visitorId: string) {
  return getBucket(
    new NextRequest(
      `https://www.recopyfa.st/api/ab-tests/bucket/${SITE_ID}?token=t&visitor_id=${visitorId}`,
      { headers: { origin: "https://example.com" } },
    ),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  );
}

describe("A/B variant ordering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (
      authorizeSiteRequest as jest.MockedFunction<typeof authorizeSiteRequest>
    ).mockResolvedValue({
      site: { id: SITE_ID, domain: "example.com", api_key: "key" },
      allowedOrigin: "https://example.com",
    });
  });

  it("asks for a total order on the variants it serves the widget", async () => {
    const tests = createChain({
      result: {
        data: [
          {
            id: TEST_ID,
            name: "headline",
            target_element_id: "rcf-1",
            ab_test_variants: [variant(CONTROL_ID, true, 50)],
          },
        ],
        error: null,
      },
    });
    mockTables({ ab_tests: tests });

    await activeRequest();

    expect(tests.orders).toEqual([
      {
        column: "is_control",
        options: {
          ascending: false,
          nullsFirst: false,
          referencedTable: "ab_test_variants",
        },
      },
      {
        column: "id",
        options: { ascending: true, referencedTable: "ab_test_variants" },
      },
    ]);
  });

  it("asks for the same total order on the variants it buckets against", async () => {
    const tests = createChain({
      result: {
        data: [
          { id: TEST_ID, ab_test_variants: [variant(CONTROL_ID, true, 50)] },
        ],
        error: null,
      },
    });
    mockTables({
      ab_tests: tests,
      visitor_buckets: createChain({ result: { data: [], error: null } }),
    });

    await bucketRequest("visitor-1");

    expect(tests.orders).toEqual([
      {
        column: "is_control",
        options: {
          ascending: false,
          nullsFirst: false,
          referencedTable: "ab_test_variants",
        },
      },
      {
        column: "id",
        options: { ascending: true, referencedTable: "ab_test_variants" },
      },
    ]);
  });

  it("assigns the same variant whatever order the rows arrive in", async () => {
    const variants = [
      variant(CONTROL_ID, true, 34),
      variant(VARIANT_B_ID, false, 33),
      variant(VARIANT_C_ID, false, 33),
    ];

    async function assignmentsFor(rows: ReturnType<typeof variant>[]) {
      mockTables({
        ab_tests: createChain({
          result: {
            data: [{ id: TEST_ID, ab_test_variants: rows }],
            error: null,
          },
        }),
        visitor_buckets: createChain({ result: { data: [], error: null } }),
      });
      const response = await bucketRequest("visitor-reorder");
      return (await response.json()).assignments as Record<string, string>;
    }

    // Same three variants, three orders Postgres is equally entitled to return.
    const inOrder = await assignmentsFor(variants);
    const reversed = await assignmentsFor([...variants].reverse());
    const shuffled = await assignmentsFor([
      variants[1],
      variants[0],
      variants[2],
    ]);

    expect(reversed[TEST_ID]).toBe(inOrder[TEST_ID]);
    expect(shuffled[TEST_ID]).toBe(inOrder[TEST_ID]);
  });
});
