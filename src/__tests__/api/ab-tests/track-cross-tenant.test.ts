/**
 * H-1 — /api/ab-tests/track authorizes a site and then trusts the body about
 * which test the events belong to.
 *
 * `ab_test_results` has no `site_id` column (20260127_ab_testing_v2.sql:8-20):
 * `test_id` is the ONLY link between a result row and a tenant. The route took
 * that id straight from the request, inserted with the service-role client, and
 * then handed the same attacker-supplied value to `checkTestCompletion` — which
 * reads `site_id` off the *test* row and stages `variant_content` onto that
 * site's `content_elements` (lifecycle.ts:169-195).
 *
 * So a caller holding a valid token for site A could name site B's test and
 * cause a service-role write to site B's staged copy. The token is not a high
 * bar: it ships as a plain `data-site-token` attribute in the customer's page
 * markup, and the Origin pin that makes it safe is browser-enforced
 * (site-auth.ts:157-174).
 *
 * The test below is the attack. Its fixtures are wired so that the UNFIXED
 * route completes the whole chain — insert, significance check, promotion —
 * which is what makes "content_elements was never touched" a real assertion
 * rather than a vacuous one.
 *
 * Nothing here mocks `authorizeSiteRequest`: the token is a real HMAC and site
 * A's authorization genuinely succeeds. The bug was never about authentication.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildSiteToken } from "@/lib/security/site-auth";
import { rateLimiter } from "@/lib/security/rate-limiter";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

import { POST as postTrack } from "@/app/api/ab-tests/track/route";

const SITE_A = "11111111-1111-1111-1111-111111111111";
const SITE_B = "22222222-2222-2222-2222-222222222222";
const API_KEY_A = "site-a-api-key";
const ORIGIN_A = "https://tenant-a.example";

/** A test that belongs to site A — the caller's own. */
const TEST_A = "33333333-3333-3333-3333-333333333333";
const VARIANT_A_CONTROL = "44444444-4444-4444-4444-444444444444";

/** A test that belongs to site B — the victim's. */
const TEST_B = "55555555-5555-5555-5555-555555555555";
const VARIANT_B_CONTROL = "66666666-6666-6666-6666-666666666666";
const VARIANT_B_TREATMENT = "77777777-7777-7777-7777-777777777777";

interface QueryResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

interface RecordedWrite {
  table: string;
  op: "insert" | "update" | "upsert";
  payload: unknown;
}

type TableChain = Record<string, jest.Mock> & {
  then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
};

/** What the builder was last asked for, when a queue is too blunt to say. */
interface QueryState {
  columns: string;
  writing: boolean;
}

type TableScript = QueryResult[] | ((state: QueryState) => QueryResult);

/**
 * A stand-in for a PostgREST builder.
 *
 * Two scripting modes, and both are needed here:
 *
 *  - A QUEUE, consumed by `await chain` and `chain.single()` alike, so a table
 *    queried repeatedly with the same shape answers differently each time. That
 *    is the only way to give the six `ab_test_results` counts inside
 *    `checkTestCompletion` six different answers.
 *  - A FUNCTION of the selected columns, for a table whose queries differ in
 *    shape rather than in order. `ab_tests` has to be this: the fix adds one
 *    query the unfixed route never makes, so a queue would answer the unfixed
 *    run one entry out of step and the promotion chain — the thing this test
 *    exists to prove is unreachable — would fall over for the wrong reason.
 */
function createTable(
  name: string,
  script: TableScript,
  log: RecordedWrite[],
): TableChain {
  const queue = Array.isArray(script) ? [...script] : [];
  const state: QueryState = { columns: "", writing: false };

  const take = (): QueryResult => {
    if (!Array.isArray(script)) return script(state);
    return queue.length > 1
      ? queue.shift()!
      : (queue[0] ?? { data: null, error: null });
  };

  const chain = {
    select: jest.fn((columns?: string) => {
      state.columns = columns ?? "";
      state.writing = false;
      return chain;
    }),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    not: jest.fn(() => chain),
    order: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve(take())),
    maybeSingle: jest.fn(() => Promise.resolve(take())),
    insert: jest.fn((payload: unknown) => {
      log.push({ table: name, op: "insert", payload });
      state.writing = true;
      return Promise.resolve(take());
    }),
    upsert: jest.fn((payload: unknown) => {
      log.push({ table: name, op: "upsert", payload });
      state.writing = true;
      return Promise.resolve(take());
    }),
    update: jest.fn((payload: unknown) => {
      log.push({ table: name, op: "update", payload });
      state.writing = true;
      return chain;
    }),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(take()).then(resolve, reject),
  } as unknown as TableChain;

  return chain;
}

interface WireOptions {
  /** What the ownership query returns for the authorized site. */
  ownedTests?: unknown[];
  /** Make the ownership query itself fail. */
  ownershipError?: { message: string };
  /**
   * The running view count for the test. `checkTestCompletion` only runs when
   * `totalViews % 50 < insertedCount`, so this is the switch that decides
   * whether the promotion chain is reachable at all.
   */
  totalViews?: number;
}

/** Site A's own test, as the ownership query would return it. */
const OWNED_BY_A = [
  { id: TEST_A, ab_test_variants: [{ id: VARIANT_A_CONTROL }] },
];

/**
 * The database as the attack sees it.
 *
 * Site B's test is deliberately absent from what the ownership query returns —
 * that is the whole point — while every downstream fixture is present and
 * healthy, so the unfixed route sails all the way to `content_elements`.
 */
function wireDatabase(options: WireOptions = {}) {
  const { ownedTests = OWNED_BY_A, ownershipError, totalViews = 100 } = options;
  const log: RecordedWrite[] = [];

  const tables: Record<string, TableChain> = {
    sites: createTable(
      "sites",
      [
        {
          data: { id: SITE_A, domain: "tenant-a.example", api_key: API_KEY_A },
          error: null,
        },
      ],
      log,
    ),
    ab_tests: createTable(
      "ab_tests",
      ({ columns, writing }) => {
        // The ownership query this fix introduces.
        if (columns.includes("ab_test_variants(id)")) {
          return ownershipError
            ? { data: null, error: ownershipError }
            : { data: ownedTests, error: null };
        }
        // checkTestCompletion's full test row — site B's, complete and active,
        // so the unfixed route has every reason to carry on.
        if (columns.includes("ab_test_variants(*)")) {
          return {
            data: {
              id: TEST_B,
              site_id: SITE_B,
              status: "active",
              auto_complete: true,
              min_sample_size: 100,
              confidence_threshold: 0.95,
              target_element_id: "rcf-hero",
              end_date: null,
              ab_test_variants: [
                { id: VARIANT_B_CONTROL, name: "control", is_control: true },
                {
                  id: VARIANT_B_TREATMENT,
                  name: "treatment",
                  is_control: false,
                },
              ],
            },
            error: null,
          };
        }
        // promoteWinner's own read: the site whose content is about to be staged.
        if (columns.includes("target_element_id")) {
          return {
            data: { site_id: SITE_B, target_element_id: "rcf-hero" },
            error: null,
          };
        }
        // The status/winner update.
        if (writing) return { data: null, error: null };
        throw new Error(`unexpected ab_tests query: "${columns}"`);
      },
      log,
    ),
    ab_test_variants: createTable(
      "ab_test_variants",
      [{ data: { variant_content: "PWNED", is_control: false }, error: null }],
      log,
    ),
    ab_test_results: createTable(
      "ab_test_results",
      [
        { count: 0, data: null, error: null }, // dedupe: visitor has no view yet
        { data: null, error: null }, // the insert
        { count: totalViews, data: null, error: null }, // running view total
        { count: 100, data: null, error: null }, // control views
        { count: 0, data: null, error: null }, // control clicks
        { count: 10, data: null, error: null }, // control conversions
        { count: 100, data: null, error: null }, // treatment views
        { count: 0, data: null, error: null }, // treatment clicks
        { count: 40, data: null, error: null }, // treatment conversions — significant
      ],
      log,
    ),
    content_elements: createTable(
      "content_elements",
      [
        { data: null, error: null }, // the staging_content update
        { data: { id: "content-element-1" }, error: null }, // history lookup
      ],
      log,
    ),
    content_history: createTable("content_history", [{ error: null }], log),
  };

  const client = {
    from: jest.fn((table: string) => {
      const chain = tables[table];
      if (!chain) throw new Error(`unexpected table: ${table}`);
      return chain;
    }),
  };

  (createServiceRoleClient as jest.Mock).mockReturnValue(client);

  return { client, log, tables };
}

function trackRequest(events: unknown[], token: string) {
  return new NextRequest(
    `https://www.recopyfa.st/api/ab-tests/track?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN_A },
      body: JSON.stringify(events),
    },
  );
}

/** One view event, exactly the shape the widget sends. */
function viewEvent(overrides: Record<string, unknown> = {}) {
  return {
    site_id: SITE_A,
    test_id: TEST_A,
    variant_id: VARIANT_A_CONTROL,
    visitor_id: "visitor-1",
    event_type: "view",
    ...overrides,
  };
}

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;

describe("POST /api/ab-tests/track — the test_id is a tenant boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    checkLimit.mockResolvedValue({
      allowed: true,
      remaining: 999,
      resetTime: Date.now() + 60_000,
      totalRequests: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records events for a test that belongs to the authorized site", async () => {
    // The control. Without it, every refusal below could be the route refusing
    // everything, and the tenant check would prove nothing. `totalViews` is off
    // a multiple of 50 so the request ends at the insert.
    const { log, tables } = wireDatabase({ totalViews: 137 });

    const response = await postTrack(
      trackRequest([viewEvent()], buildSiteToken(SITE_A, API_KEY_A)),
    );

    expect(response.status).toBe(200);
    expect(
      log.filter((op) => op.table === "ab_test_results" && op.op === "insert"),
    ).toHaveLength(1);

    // Scoped to the caller's site, and asking only about the ids in the batch.
    expect(tables.ab_tests.eq).toHaveBeenCalledWith("site_id", SITE_A);
    expect(tables.ab_tests.in).toHaveBeenCalledWith("id", [TEST_A]);
  });

  it("refuses a batch naming another tenant's test, and writes nothing", async () => {
    const { log, client } = wireDatabase();

    const response = await postTrack(
      trackRequest(
        [viewEvent({ test_id: TEST_B, variant_id: VARIANT_B_TREATMENT })],
        buildSiteToken(SITE_A, API_KEY_A),
      ),
    );

    expect(response.status).toBe(403);

    // Site B's results table is untouched: no row was filed against its test.
    expect(log).toHaveLength(0);

    // And the chain that ends in a service-role write to site B's staged copy is
    // never entered at all — `checkTestCompletion` is only reachable past the
    // insert, and `promoteWinner` past that.
    const tablesTouched = client.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).not.toContain("ab_test_results");
    expect(tablesTouched).not.toContain("ab_test_variants");
    expect(tablesTouched).not.toContain("content_elements");
    expect(tablesTouched).not.toContain("content_history");
  });

  it("refuses the whole batch when one event smuggles a foreign test", async () => {
    // Filtering the bad events out and recording the rest would leave the caller
    // unable to tell what landed. A partial write is worse than a clear refusal.
    const { log } = wireDatabase();

    const response = await postTrack(
      trackRequest(
        [
          viewEvent({ visitor_id: "visitor-1" }),
          viewEvent({
            visitor_id: "visitor-2",
            test_id: TEST_B,
            variant_id: VARIANT_B_CONTROL,
          }),
        ],
        buildSiteToken(SITE_A, API_KEY_A),
      ),
    );

    expect(response.status).toBe(403);
    expect(log).toHaveLength(0);
  });

  it("refuses a variant that belongs to no test of this site", async () => {
    // The FK on ab_test_results.variant_id only proves the variant exists
    // SOMEWHERE (20260127_ab_testing_v2.sql:11), not that it belongs to the test
    // the row is filed under — or to this tenant at all.
    const { log } = wireDatabase();

    const response = await postTrack(
      trackRequest(
        [viewEvent({ variant_id: VARIANT_B_TREATMENT })],
        buildSiteToken(SITE_A, API_KEY_A),
      ),
    );

    expect(response.status).toBe(403);
    expect(log).toHaveLength(0);
  });

  it("refuses everything when the ownership query itself fails", async () => {
    // Fail closed: a database that cannot say which tests belong to this site
    // has not said that these ones do.
    const { log } = wireDatabase({ ownershipError: { message: "boom" } });

    const response = await postTrack(
      trackRequest([viewEvent()], buildSiteToken(SITE_A, API_KEY_A)),
    );

    expect(response.status).toBe(500);
    expect(log).toHaveLength(0);
  });
});
