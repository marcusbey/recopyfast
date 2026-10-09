/**
 * s82 review, finding 1 — Checkout never sells a subscription a lifetime grant
 * already includes.
 *
 * The subscription intent of `POST /api/billing/checkout` never read grants;
 * only the lifetime intent did. A Lifetime Pro owner with no subscription could
 * open "Change plan", pick Starter (or Pro, by request) and be billed every
 * month for a plan the grant already covers — and nothing stops it afterwards:
 * the Stripe webhook cancels subscriptions only when a lifetime is BOUGHT
 * (`stopBillingForLifetimeOwner`), not when a subscription starts beside one.
 *
 * The rule is the reactivate route's and the webhook's: a grant covers its own
 * plan and every lower one (`isPlanCoveredByGrants`), so an Agency
 * subscription beside Lifetime Pro stays on sale.
 *
 * The real `getGrantedPlanIds` → `readGrantedPlanIds` runs here over a fake
 * client that applies the query's own filters (`eq` / `is` / `neq` / `or`) to
 * seeded rows, so "a trial does not count", "a revoked grant does not count"
 * and "an expired grant does not count" (finding 2) are proved by the filters
 * production sends. Stripe is a mock; nothing is called for real.
 */

import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const USER_ID = "user-1";

let grants: Row[] = [];
let grantReadFails = false;

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

function grantQuery() {
  const predicates: Array<(row: Row) => boolean> = [];
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      predicates.push((row) => row[column] === value);
      return query;
    },
    is: (column: string, value: unknown) => {
      predicates.push((row) => (row[column] ?? null) === value);
      return query;
    },
    neq: (column: string, value: unknown) => {
      predicates.push((row) => row[column] !== value);
      return query;
    },
    or: (expression: string) => {
      const arms = expression.split(",").map(armPredicate);
      predicates.push((row) => arms.some((arm) => arm(row)));
      return query;
    },
    returns: () => query,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        grantReadFails
          ? { data: null, error: { message: "connection reset" } }
          : {
              data: grants.filter((row) =>
                predicates.every((keep) => keep(row)),
              ),
              error: null,
            },
      ).then(resolve),
  };
  return query;
}

/** No live subscription row: the account has nothing billing it. */
function subscriptionQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return query;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID, email: "owner@example.com" } },
        error: null,
      }),
    },
    from: (table: string) =>
      table === "plan_entitlements" ? grantQuery() : subscriptionQuery(),
  })),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({})),
}));

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));

const mockCreateCheckoutSession = jest.fn();

jest.mock("@/lib/stripe/checkout", () => ({
  createCheckoutSession: (...args: unknown[]) =>
    mockCreateCheckoutSession(...args),
  preflightLifetimeCheckout: jest.fn(),
  findCheckoutSessionForIntent: jest.fn(async () => null),
  getCheckoutSessionStatus: jest.fn(),
  expireCheckoutSession: jest.fn(),
}));

const mockGetRecoverable = jest.fn();

jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: jest.fn(async () => null),
  // Asks Stripe about every recoverable row: reaching it means the request
  // got past the lifetime check and into the paid flow.
  getRecoverableSubscriptionCheckout: (...args: unknown[]) =>
    mockGetRecoverable(...args),
}));

jest.mock("@/lib/billing/checkout-reservation", () => ({
  ...jest.requireActual("@/lib/billing/checkout-reservation"),
  claimSubscriptionCheckoutIntent: jest.fn(
    async (
      _client: unknown,
      userId: string,
      choice: { stripePriceId: string; planId: string; billingPeriod: string },
    ) => ({
      id: "intent-1",
      userId,
      stripeSessionId: null,
      checkoutUrl: null,
      ...choice,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      isNew: true,
    }),
  ),
  attachCheckoutSession: jest.fn(async () => true),
}));

jest.mock("@/lib/billing/founding-agency", () => ({
  bindFoundingAgencyCheckout: jest.fn(),
  getOpenFoundingAgencyCheckout: jest.fn(),
  reconcileExpiredFoundingAgencyCheckouts: jest.fn(),
  releaseFoundingAgencyCheckout: jest.fn(),
  reserveFoundingAgencySpot: jest.fn(),
}));

jest.mock("@/lib/stripe/plans", () => ({
  isAgencyCheckoutEnabled: () => true,
  isPaidPlanId: (value: unknown) =>
    value === "starter" || value === "pro" || value === "agency",
  isLifetimeProductId: (value: unknown) =>
    value === "lifetime_pro" || value === "lifetime_agency",
  isBillingPeriod: (value: unknown) =>
    value === "monthly" || value === "yearly",
  getCreditPackConfig: jest.fn(async () => ({ maxPacksPerPurchase: 10 })),
  getOneTimeProduct: jest.fn(),
  resolveStripePriceId: jest.fn(
    async (planId: string, period: string) => `price_${planId}_${period}`,
  ),
  findPlanById: jest.fn(async () => null),
  findPurchasedPlanById: jest.fn(async () => null),
}));

import { POST } from "@/app/api/billing/checkout/route";

const COVERED_REFUSAL =
  "Your lifetime plan already includes this one. There is nothing further to buy.";

const DAY_MS = 24 * 60 * 60 * 1000;

function grant(planId: string, overrides: Row = {}): Row {
  return {
    user_id: USER_ID,
    plan_id: planId,
    source: "lifetime_purchase",
    revoked_at: null,
    expires_at: null,
    ...overrides,
  };
}

function subscribe(planId: string) {
  return POST(
    new NextRequest("https://www.recopyfa.st/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "subscription", planId }),
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  grants = [];
  grantReadFails = false;
  mockGetRecoverable.mockResolvedValue(null);
  mockCreateCheckoutSession.mockResolvedValue({
    sessionId: "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function expectRefused(planId: string) {
  const response = await subscribe(planId);

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({ error: COVERED_REFUSAL });
  // Refused before anything reaches Stripe: no recovery lookup, no session.
  expect(mockGetRecoverable).not.toHaveBeenCalled();
  expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
}

async function expectSold(planId: string) {
  const response = await subscribe(planId);

  expect(response.status).toBe(200);
  expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
    USER_ID,
    "owner@example.com",
    { type: "subscription", planId, billingPeriod: "monthly" },
    undefined,
    expect.objectContaining({ pendingIntentId: "intent-1" }),
  );
}

describe("checkout refuses a subscription a lifetime grant includes", () => {
  it("refuses Pro to a Lifetime Pro owner", async () => {
    grants = [grant("pro")];
    await expectRefused("pro");
  });

  it("refuses a lower plan (Starter) to a Lifetime Pro owner", async () => {
    grants = [grant("pro")];
    await expectRefused("starter");
  });

  it("refuses Agency and Pro to a Founding Agency owner", async () => {
    grants = [grant("agency")];
    await expectRefused("agency");
    await expectRefused("pro");
  });

  it("refuses under a comped grant too: it is held for life all the same", async () => {
    grants = [grant("pro", { source: "support" })];
    await expectRefused("starter");
  });

  it("refuses under a dated grant that has not expired yet", async () => {
    grants = [
      grant("pro", {
        source: "qa_recovery_20260919",
        expires_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      }),
    ];
    await expectRefused("pro");
  });

  it("fails closed, before Stripe, when the grants cannot be read", async () => {
    grantReadFails = true;

    const response = await subscribe("pro");

    expect(response.status).toBe(500);
    expect(mockGetRecoverable).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });
});

describe("checkout still sells what no grant includes (unchanged)", () => {
  // The webhook keeps a running Agency subscription beside a Lifetime Pro
  // grant (`grantsPlanId === "pro" && subscription.plan === "agency"`).
  it("sells Agency to a Lifetime Pro owner", async () => {
    grants = [grant("pro")];
    await expectSold("agency");
  });

  it("sells Pro when the only Pro row is a trial", async () => {
    grants = [grant("pro", { source: "trial" })];
    await expectSold("pro");
  });

  it("sells Pro when the lifetime grant was revoked", async () => {
    grants = [grant("pro", { revoked_at: "2026-09-20T00:00:00.000Z" })];
    await expectSold("pro");
  });

  // Finding 2: production holds a non-trial grant with an `expires_at`
  // (source `qa_recovery_20260919`). Once that date passes the account holds
  // nothing, exactly as the entitlement resolver already says.
  it("sells Pro once a dated non-trial grant has expired", async () => {
    grants = [
      grant("pro", {
        source: "qa_recovery_20260919",
        expires_at: new Date(Date.now() - DAY_MS).toISOString(),
      }),
    ];
    await expectSold("pro");
  });

  it("sells Pro when another account holds the grant", async () => {
    grants = [grant("agency", { user_id: "someone-else" })];
    await expectSold("pro");
  });

  it("sells Pro to an account with no grant", async () => {
    await expectSold("pro");
  });
});
