/**
 * The trial, end to end, through the real route handlers.
 *
 * Every other suite in this story pins one function. This one closes the loop:
 * a trial is granted the way sign-in grants it, a site is registered against
 * it, the grant lapses, and the same request is refused — with nothing between
 * those steps but the routes themselves and one in-memory database.
 *
 * It also exists to prove three *absences* the plan asserts, which prose cannot:
 *
 *   * `POST /api/billing/checkout` needs no change to convert mid-trial —
 *     `checkout-reservation.ts` and `user-lock.ts` run here for real, and the
 *     trial is invisible to both;
 *   * `GET /api/content/:siteId` never consults entitlement, so an expired
 *     trial does not take a customer's site down;
 *   * a trialling account has no Stripe customer and no subscription row
 *     anywhere — the trial is not a card-less Stripe subscription wearing a
 *     different hat.
 *
 * Only genuinely external things are stubbed: Stripe's network call, the rate
 * limiter, and the plan catalogue loader. Entitlement resolution, the feature
 * gate, the checkout lock and the site-auth path all run as shipped.
 */

import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
type FakeError = { message: string; code?: string } | null;
interface Result {
  data: unknown;
  error: FakeError;
  count?: number | null;
}

/** The one database every client in this test shares. */
let mockDb: Record<string, Row[]> = {};

const mockGetUser = jest.fn();

let generatedIds = 0;
function nextId(prefix: string): string {
  generatedIds += 1;
  return `${prefix}_${generatedIds}`;
}

/** One arm of a PostgREST `.or()` expression, e.g. `expires_at.gt.<iso>`. */
function armPredicate(arm: string): (row: Row) => boolean {
  const [column, operator, ...rest] = arm.split(".");
  const value = rest.join(".");

  if (operator === "is" && value === "null") {
    return (row) => (row[column] ?? null) === null;
  }
  if (operator === "gt") {
    return (row) => String(row[column] ?? "") > value;
  }
  throw new Error(`Unsupported or() arm in test stub: ${arm}`);
}

/**
 * Columns the database fills in, and the one constraint that matters here.
 *
 * `plan_entitlements_one_trial_per_user` is a partial unique index in the
 * migration, and it is the whole of "one trial per account, ever" — so the
 * stub enforces it rather than letting a second grant quietly succeed and make
 * this suite lie about AC 6.
 */
function insertInto(
  table: string,
  payload: Row,
): { row: Row; error: FakeError } {
  if (
    table === "plan_entitlements" &&
    payload.source === "trial" &&
    (mockDb[table] ?? []).some(
      (row) => row.source === "trial" && row.user_id === payload.user_id,
    )
  ) {
    return {
      row: payload,
      error: {
        message:
          'duplicate key value violates unique constraint "plan_entitlements_one_trial_per_user"',
        code: "23505",
      },
    };
  }

  const defaults: Row = { id: nextId(table) };
  if (table === "sites") {
    defaults.api_key = nextId("apikey");
    defaults.created_at = new Date().toISOString();
  }
  if (table === "plan_entitlements" && payload.granted_at === undefined) {
    defaults.granted_at = new Date().toISOString();
  }

  const row: Row = { ...defaults, ...payload };
  mockDb[table] = [...(mockDb[table] ?? []), row];
  return { row, error: null };
}

function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let sort: { column: string; ascending: boolean } | null = null;
    let cap: number | null = null;
    let mode: "select" | "insert" | "upsert" | "update" = "select";
    let payload: Row = {};
    let conflictColumns: string[] = [];
    let headCount = false;

    const matching = (): Row[] => {
      let rows = (mockDb[table] ?? []).filter((row) =>
        predicates.every((predicate) => predicate(row)),
      );
      if (sort) {
        const { column, ascending } = sort;
        rows = [...rows].sort(
          (a, b) =>
            String(a[column] ?? "").localeCompare(String(b[column] ?? "")) *
            (ascending ? 1 : -1),
        );
      }
      return cap === null ? rows : rows.slice(0, cap);
    };

    const run = (): Result => {
      if (mode === "insert") {
        const { row, error } = insertInto(table, payload);
        return { data: error ? null : [row], error };
      }
      if (mode === "upsert") {
        if (conflictColumns.length > 0) {
          mockDb[table] = (mockDb[table] ?? []).filter(
            (row) =>
              !conflictColumns.every(
                (column) => row[column] === payload[column],
              ),
          );
        }
        const { row, error } = insertInto(table, payload);
        return { data: error ? null : [row], error };
      }
      if (mode === "update") {
        const targeted = matching();
        mockDb[table] = (mockDb[table] ?? []).map((row) =>
          targeted.includes(row) ? { ...row, ...payload } : row,
        );
        return {
          data: targeted.map((row) => ({ ...row, ...payload })),
          error: null,
        };
      }
      const rows = matching();
      return headCount
        ? { data: null, error: null, count: rows.length }
        : { data: rows, error: null };
    };

    const builder: Record<string, unknown> = {
      select: (
        _columns?: string,
        options?: { head?: boolean; count?: string },
      ) => {
        if (options?.head) headCount = true;
        return builder;
      },
      returns: () => builder,
      eq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] !== value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      in: (column: string, allowed: unknown[]) => {
        predicates.push((row) => allowed.includes(row[column]));
        return builder;
      },
      gt: (column: string, value: number) => {
        predicates.push((row) => Number(row[column] ?? 0) > value);
        return builder;
      },
      gte: (column: string, value: string) => {
        predicates.push((row) => String(row[column] ?? "") >= value);
        return builder;
      },
      or: (expression: string) => {
        const arms = expression.split(",").map(armPredicate);
        predicates.push((row) => arms.some((arm) => arm(row)));
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        sort = { column, ascending: options?.ascending !== false };
        return builder;
      },
      limit: (count: number) => {
        cap = count;
        return builder;
      },
      insert: (values: Row) => {
        mode = "insert";
        payload = values;
        return builder;
      },
      upsert: (values: Row, options?: { onConflict?: string }) => {
        mode = "upsert";
        payload = values;
        conflictColumns = options?.onConflict?.split(",") ?? [];
        return builder;
      },
      update: (values: Row) => {
        mode = "update";
        payload = values;
        return builder;
      },
      maybeSingle: async () => {
        const result = run();
        const rows = result.data as Row[] | null;
        return { data: rows?.[0] ?? null, error: result.error };
      },
      // PostgREST's .single() errors on no rows; both call sites here treat a
      // null row and an error identically, so "not found" is reported as null.
      single: async () => {
        const result = run();
        const rows = result.data as Row[] | null;
        return { data: rows?.[0] ?? null, error: result.error };
      },
      then: <T>(
        resolve: (result: Result) => T,
        reject?: (reason: unknown) => T,
      ) => Promise.resolve(run()).then(resolve, reject),
    };

    return builder;
  };

  return { auth: { getUser: mockGetUser }, from };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => createFakeClient()),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => createFakeClient()),
}));

// Rate limiting is infrastructure, not behaviour under test here.
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

// The catalogue is loaded from the `plans` table in production. Its contents
// are pinned by plan-seed.test.ts; what matters here is that a trial resolves
// to the SAME Pro row a subscriber gets, with no trial-specific plan anywhere.
jest.mock("@/lib/stripe/plans", () => ({
  findPlanById: jest.fn(async (planId: string) =>
    planId === "pro"
      ? {
          id: "pro",
          name: "Pro",
          description: "",
          price: 19,
          yearlyPrice: 15.77,
          features: [],
          limits: {
            websites: 5,
            collaborators: 5,
            aiFeatures: true,
            translations: -1,
            abTesting: true,
            monthlyCredits: 500,
          },
          additionalSitePrice: 5,
          sortOrder: 20,
        }
      : null,
  ),
  isPaidPlanId: (value: unknown) => value === "starter" || value === "pro",
  isBillingPeriod: (value: unknown) =>
    value === "monthly" || value === "yearly",
  getCreditPackConfig: jest.fn(async () => ({ maxPacksPerPurchase: 10 })),
  getLifetimeGrantPlanId: jest.fn(async () => "pro"),
  getPaidPlan: jest.fn(),
  resolveStripePriceId: jest.fn(),
}));

const mockCreateCheckoutSession = jest.fn();

jest.mock("@/lib/stripe/checkout", () => ({
  createCheckoutSession: (...args: unknown[]) =>
    mockCreateCheckoutSession(...args),
  getCheckoutSessionStatus: jest.fn(),
}));

import { ensureTrialStarted } from "@/lib/billing/trial";
import { POST as registerSite } from "@/app/api/sites/register/route";
import { GET as readContent } from "@/app/api/content/[siteId]/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";

const USER_ID = "user-1";
const EMAIL = "agency@example.test";

/** The client `ensureTrialStarted` is handed; it only forwards it. */
const cookieClient = createFakeClient() as never;

function registerRequest(domain: string, name: string): NextRequest {
  return new NextRequest("http://localhost/api/sites/register", {
    method: "POST",
    body: JSON.stringify({ domain, name }),
  });
}

function contentRequest(siteId: string): NextRequest {
  return new NextRequest(`http://localhost/api/content/${siteId}`);
}

function checkoutRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

async function registerSiteFor(domain: string, name: string) {
  const response = await registerSite(registerRequest(domain, name));
  return { status: response.status, body: await response.json() };
}

/** Push the trial's expiry into the past, exactly as day fifteen does. */
function expireTheTrial() {
  mockDb.plan_entitlements = (mockDb.plan_entitlements ?? []).map((row) =>
    row.source === "trial"
      ? {
          ...row,
          granted_at: new Date(Date.now() - 20 * 86400000).toISOString(),
          expires_at: new Date(Date.now() - 6 * 86400000).toISOString(),
        }
      : row,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  generatedIds = 0;
  mockDb = {
    plan_entitlements: [],
    billing_subscriptions: [],
    billing_customers: [],
    credit_purchases: [],
    checkout_reservations: [],
    sites: [],
    site_permissions: [],
    content_elements: [],
  };
  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: EMAIL, user_metadata: {} } },
    error: null,
  });
  mockCreateCheckoutSession.mockResolvedValue({
    sessionId: "cs_test_1",
    url: "https://checkout.stripe.test/cs_test_1",
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a trial, from sign-in to expiry", () => {
  it("lets a brand-new account register a site with no Stripe anything", async () => {
    await ensureTrialStarted(cookieClient, USER_ID);

    const { status, body } = await registerSiteFor("example.com", "Example");

    expect(status).toBe(200);
    expect(body.site.domain).toBe("example.com");
    // AC 1: entitled, with nothing on file at Stripe. A trial that needed a
    // customer or a subscription row would be a card-less Stripe subscription,
    // which is the modelling ADR 014 rejected.
    expect(mockDb.billing_customers).toHaveLength(0);
    expect(mockDb.billing_subscriptions).toHaveLength(0);
    expect(mockDb.plan_entitlements).toHaveLength(1);
    expect(mockDb.plan_entitlements[0]).toMatchObject({
      plan_id: "pro",
      source: "trial",
      stripe_payment_intent_id: null,
    });
  });

  it("refuses the next site once the fourteen days are up", async () => {
    await ensureTrialStarted(cookieClient, USER_ID);
    await registerSiteFor("example.com", "Example");

    // Day fifteen. No cron ran and nothing was revoked — the row is simply no
    // longer selected by the expiry predicate inside readEffectivePlanId.
    expireTheTrial();

    const { status, body } = await registerSiteFor("second.com", "Second");

    expect(status).toBe(403);
    // AC 3, on the wire name the API already uses.
    expect(body.upgrade_required).toBe(true);
    expect(mockDb.sites).toHaveLength(1);
  });

  it("keeps serving the site's content after the trial ends", async () => {
    await ensureTrialStarted(cookieClient, USER_ID);
    const { body } = await registerSiteFor("example.com", "Example");
    const siteId = body.site.id as string;

    mockDb.content_elements = [
      {
        id: "el_1",
        site_id: siteId,
        element_id: "hero-title",
        selector: "h1",
        original_content: "Original headline",
        published_content: "Edited headline",
        language: "en",
        variant: "default",
        metadata: {},
        published_at: new Date().toISOString(),
      },
    ];

    expireTheTrial();

    const response = await readContent(contentRequest(siteId), {
      params: Promise.resolve({ siteId }),
    });
    const elements = await response.json();

    // AC 4: content delivery authorises on the site, never on the owner's plan.
    // Nothing under /api/content reads an entitlement, and this is what says so.
    expect(response.status).toBe(200);
    expect(elements).toHaveLength(1);
    expect(elements[0].current_content).toBe("Edited headline");
  });

  it("lets a trialling customer start a subscription checkout", async () => {
    await ensureTrialStarted(cookieClient, USER_ID);

    const response = await checkout(
      checkoutRequest({ intent: "subscription", planId: "pro" }),
    );

    // AC 5: the trial is invisible to the checkout guard, the reservation and
    // the lock — none of them read plan_entitlements. Conversion needs no
    // revocation, so no request can observe a gap.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: "cs_test_1",
    });
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mockDb.checkout_reservations).toHaveLength(1);
  });

  it("keeps the customer entitled through conversion, with no gap", async () => {
    await ensureTrialStarted(cookieClient, USER_ID);
    await checkout(checkoutRequest({ intent: "subscription", planId: "pro" }));

    // The webhook lands. The trial grant is left alone, on its own clock.
    mockDb.billing_subscriptions = [
      {
        id: "sub_1",
        user_id: USER_ID,
        plan: "pro",
        status: "active",
        created_at: new Date().toISOString(),
      },
    ];
    expireTheTrial();

    const { status } = await registerSiteFor("converted.com", "Converted");

    // The moment the old trial lapses is the moment a post-query expiry check
    // would have started refusing a paying customer.
    expect(status).toBe(200);
  });

  it("still sells Lifetime Pro to an account that is only trialling", async () => {
    await ensureTrialStarted(cookieClient, USER_ID);

    const response = await checkout(checkoutRequest({ intent: "lifetime" }));

    // A trial answering "you already hold pro" would refuse the $199 purchase
    // with a 409 that reads as intentional, for every trialling account.
    expect(response.status).toBe(200);
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("hands out exactly one trial however many times the account signs in", async () => {
    await ensureTrialStarted(cookieClient, USER_ID);
    await ensureTrialStarted(cookieClient, USER_ID);
    expireTheTrial();
    // Signing in again after it lapsed: the entitlement check now says
    // "nothing", so only the database index stands between this account and a
    // second free fortnight.
    await ensureTrialStarted(cookieClient, USER_ID);

    expect(mockDb.plan_entitlements).toHaveLength(1);
    const { status } = await registerSiteFor("again.com", "Again");
    expect(status).toBe(403);
  });
});
