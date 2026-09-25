/**
 * A-21 — two concurrent checkouts create two subscriptions.
 *
 * `src/app/api/billing/checkout/route.ts:106-117` guards the subscription
 * intent with `getUserSubscription`, which reads `billing_subscriptions` — a
 * table written only by the Stripe webhook, *after* the first payment
 * completes. Two clicks (or a double-submit, or a retried request) both find
 * nothing and both get a Checkout Session, and both land as separate rows and
 * separate monthly charges.
 *
 * The lifetime intent beside it (`:129-149`) does have a real server-side
 * precondition; the subscription intent has no concurrency-safe equivalent.
 * That contrast is pinned by the fix-stable cases at the bottom.
 *
 * `getUserSubscription` is stubbed to read the same in-memory table the webhook
 * would write, and is held at a barrier so both callers genuinely observe the
 * empty state. The defect under test is the check-then-act in the route, not
 * anything inside that read.
 */

type Row = Record<string, unknown>;
type RowsResult = { data: Row[] | null; error: null };

let db: Record<string, Row[]> = {};
let pendingIntent: Row | null = null;
let pendingIntentAfterFinish: Row | null = null;
let failNextAttach = false;
let failSubscriptionRead = false;
let failClaim = false;
let blockClaimForSubscription = false;
let mockBypassUserLock = false;

const mockGetUser = jest.fn();
const mockEnforceRateLimit = jest.fn();

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

/**
 * Cookie-scoped client. `from()` is a working in-memory store rather than a
 * stub so a fix that reserves the intent in the database has something to run
 * against.
 */
function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" = "select";
    let values: Row = {};

    const rows = (): Row[] => db[table] ?? [];

    const run = (): RowsResult => {
      if (operation === "insert") {
        db[table] = [...rows(), { ...values }];
        return { data: [{ ...values }], error: null };
      }
      return {
        data: rows().filter((row) =>
          predicates.every((predicate) => predicate(row)),
        ),
        error: null,
      };
    };

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, allowed: unknown[]) => {
        predicates.push((row) => allowed.includes(row[column]));
        return builder;
      },
      is: (column: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (payload: Row) => {
        operation = "insert";
        values = payload;
        return builder;
      },
      maybeSingle: async () => {
        if (table === "billing_subscriptions" && failSubscriptionRead) {
          return { data: null, error: { message: "read failed" } };
        }
        const { data } = run();
        return { data: data?.[0] ?? null, error: null };
      },
      then: <T>(
        resolve: (result: RowsResult) => T,
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

const mockIntentClient = {
  rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_subscription_checkout_intent") {
      if (failClaim) {
        return { data: null, error: { message: "claim failed" } };
      }
      if (blockClaimForSubscription) {
        return {
          data: null,
          error: {
            code: "P0001",
            message: "user already has a non-terminal subscription",
          },
        };
      }
      if (!pendingIntent) {
        pendingIntent = {
          id: "intent_1",
          user_id: USER_ID,
          stripe_session_id: null,
          checkout_url: null,
          stripe_price_id: args.p_stripe_price_id,
          plan_id: args.p_plan_id,
          billing_period: args.p_billing_period,
          expires_at: args.p_expires_at,
        };
        return { data: [{ ...pendingIntent, is_new: true }], error: null };
      }
      return {
        data: [
          {
            ...pendingIntent,
            stripe_price_id:
              pendingIntent.stripe_price_id ?? "price_pro_monthly",
            plan_id: pendingIntent.plan_id ?? "pro",
            billing_period: pendingIntent.billing_period ?? "monthly",
            is_new: false,
          },
        ],
        error: null,
      };
    }
    if (name === "attach_subscription_checkout_session") {
      if (failNextAttach) {
        failNextAttach = false;
        return { data: null, error: { message: "write lost" } };
      }
      pendingIntent = pendingIntent
        ? {
            ...pendingIntent,
            stripe_session_id: args.p_stripe_session_id,
            checkout_url: args.p_checkout_url,
          }
        : null;
      return { data: null, error: null };
    }
    if (
      name === "finish_subscription_checkout_intent" ||
      name === "expire_unattached_subscription_checkout_intent"
    ) {
      pendingIntent = pendingIntentAfterFinish;
      pendingIntentAfterFinish = null;
      return { data: null, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  }),
};

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => mockIntentClient),
}));

const mockCreateCheckoutSession = jest.fn();
const mockPreflightLifetimeCheckout = jest.fn();
const mockFindCheckoutSessionForIntent = jest.fn();
const mockGetCheckoutSessionStatus = jest.fn();
const mockExpireCheckoutSession = jest.fn();

jest.mock("@/lib/stripe/checkout", () => ({
  createCheckoutSession: (...args: unknown[]) =>
    mockCreateCheckoutSession(...args),
  preflightLifetimeCheckout: (...args: unknown[]) =>
    mockPreflightLifetimeCheckout(...args),
  findCheckoutSessionForIntent: (...args: unknown[]) =>
    mockFindCheckoutSessionForIntent(...args),
  getCheckoutSessionStatus: (...args: unknown[]) =>
    mockGetCheckoutSessionStatus(...args),
  expireCheckoutSession: (...args: unknown[]) =>
    mockExpireCheckoutSession(...args),
}));

const mockGetUserSubscription = jest.fn();
const mockGetRecoverableSubscriptionCheckout = jest.fn();

jest.mock("@/lib/stripe/subscription", () => ({
  getUserSubscription: (...args: unknown[]) => mockGetUserSubscription(...args),
  getRecoverableSubscriptionCheckout: (...args: unknown[]) =>
    mockGetRecoverableSubscriptionCheckout(...args),
}));

const mockGetGrantedPlanIds = jest.fn();

jest.mock("@/lib/billing/entitlements", () => ({
  getGrantedPlanIds: (...args: unknown[]) => mockGetGrantedPlanIds(...args),
}));

jest.mock("@/lib/billing/user-lock", () => {
  const actual = jest.requireActual("@/lib/billing/user-lock");
  return {
    withUserLock: (userId: string, operation: () => Promise<unknown>) =>
      mockBypassUserLock ? operation() : actual.withUserLock(userId, operation),
  };
});

jest.mock("@/lib/stripe/plans", () => ({
  isAgencyCheckoutEnabled: () =>
    process.env.AGENCY_CHECKOUT_ENABLED !== "false",
  isPaidPlanId: (value: unknown) =>
    value === "starter" || value === "pro" || value === "agency",
  isLifetimeProductId: (value: unknown) =>
    value === "lifetime_pro" || value === "lifetime_agency",
  isBillingPeriod: (value: unknown) =>
    value === "monthly" || value === "yearly",
  getCreditPackConfig: jest.fn(async () => ({ maxPacksPerPurchase: 10 })),
  getLifetimeGrantPlanId: jest.fn(async () => "pro"),
  getOneTimeProduct: jest.fn(async (productId: string) => ({
    id: productId,
    grantsPlanId: productId === "lifetime_agency" ? "agency" : "pro",
  })),
  resolveStripePriceId: jest.fn(
    async (planId: string, billingPeriod: string) =>
      `price_${planId}_${billingPeriod}`,
  ),
}));

const mockReserveFoundingAgencySpot = jest.fn();
const mockBindFoundingAgencyCheckout = jest.fn();
const mockReleaseFoundingAgencyCheckout = jest.fn();
const mockReconcileExpiredFoundingAgencyCheckouts = jest.fn();
const mockGetOpenFoundingAgencyCheckout = jest.fn();

jest.mock("@/lib/billing/founding-agency", () => ({
  reserveFoundingAgencySpot: (...args: unknown[]) =>
    mockReserveFoundingAgencySpot(...args),
  bindFoundingAgencyCheckout: (...args: unknown[]) =>
    mockBindFoundingAgencyCheckout(...args),
  releaseFoundingAgencyCheckout: (...args: unknown[]) =>
    mockReleaseFoundingAgencyCheckout(...args),
  getOpenFoundingAgencyCheckout: (...args: unknown[]) =>
    mockGetOpenFoundingAgencyCheckout(...args),
  reconcileExpiredFoundingAgencyCheckouts: (...args: unknown[]) =>
    mockReconcileExpiredFoundingAgencyCheckouts(...args),
}));

import { POST } from "@/app/api/billing/checkout/route";
import { RATE_LIMIT_CONFIGS } from "@/lib/security/rate-limiter";

interface CheckoutResponse {
  status: number;
  headers: Headers;
  json: () => Promise<Record<string, unknown>>;
}

const USER_ID = "user-1";

function checkoutRequest(body: Record<string, unknown>) {
  return { json: async () => body } as never;
}

async function post(body: Record<string, unknown>): Promise<CheckoutResponse> {
  return POST(checkoutRequest(body)) as unknown as CheckoutResponse;
}

/** Releases both callers only once both have reached the same point. */
function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    await gate;
  };
}

describe("A-21: two checkouts started at once", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    db = { billing_subscriptions: [] };
    pendingIntent = null;
    pendingIntentAfterFinish = null;
    failNextAttach = false;
    failSubscriptionRead = false;
    failClaim = false;
    blockClaimForSubscription = false;
    mockBypassUserLock = false;
    process.env.AGENCY_CHECKOUT_ENABLED = "true";
    mockEnforceRateLimit.mockResolvedValue(null);
    mockGetRecoverableSubscriptionCheckout.mockResolvedValue(null);

    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "buyer@example.com" } },
      error: null,
    });
    mockGetGrantedPlanIds.mockResolvedValue([]);
    mockReserveFoundingAgencySpot.mockResolvedValue({
      outcome: "reserved",
      reservationId: "reservation-1",
      checkoutExpiresAt: 1_800_000_000,
    });
    mockBindFoundingAgencyCheckout.mockResolvedValue(undefined);
    mockPreflightLifetimeCheckout.mockResolvedValue({
      productId: "lifetime_agency",
      productName: "Founding Agency (lifetime)",
      grantsPlanId: "agency",
      priceId: "price_lifetime_agency",
      stripeCustomerId: "cus_agency",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    });
    mockReleaseFoundingAgencyCheckout.mockResolvedValue(true);
    mockReconcileExpiredFoundingAgencyCheckouts.mockResolvedValue(0);
    mockGetOpenFoundingAgencyCheckout.mockResolvedValue(null);
    mockFindCheckoutSessionForIntent.mockResolvedValue(null);
    mockGetCheckoutSessionStatus.mockResolvedValue({ status: "open" });
    mockExpireCheckoutSession.mockResolvedValue(undefined);
    mockCreateCheckoutSession.mockImplementation(async () => ({
      sessionId: `cs_${mockCreateCheckoutSession.mock.calls.length}`,
      url: "https://checkout.stripe.com/c/pay/cs_test",
      expiresAt: 1_800_000_000,
    }));
    // Reads the table the Stripe webhook writes — empty until a payment
    // completes, which is the whole point.
    mockGetUserSubscription.mockImplementation(
      async () =>
        db.billing_subscriptions?.find((row) =>
          ["active", "trialing", "past_due"].includes(String(row.status)),
        ) ?? null,
    );
  });

  /**
   * Guard for the `test.failing` below. `test.failing` passes on ANY failure,
   * including a barrier that deadlocks into a timeout or an auth mock that
   * 401s, so each marker needs a sibling proving the route ran. Here: the
   * barrier releases, both requests are authenticated and parsed, and both
   * reach the guard that reads `billing_subscriptions`.
   */
  it("guard: the barrier releases and both concurrent requests reach the guard", async () => {
    const bothReadFirst = createBarrier(2);
    const readsBillingSubscriptions =
      mockGetUserSubscription.getMockImplementation();
    mockGetUserSubscription.mockImplementation(async (...args) => {
      await bothReadFirst();
      return readsBillingSubscriptions?.(...args) ?? null;
    });

    const responses = await Promise.all([
      post({ intent: "subscription", planId: "pro" }),
      post({ intent: "subscription", planId: "pro" }),
    ]);

    expect(mockGetUserSubscription).toHaveBeenCalledTimes(2);
    expect(responses.every((response) => response.status !== 401)).toBe(true);
    expect(responses.every((response) => response.status !== 400)).toBe(true);
  });

  it("only one Checkout Session is created when two requests arrive together", async () => {
    const bothReadFirst = createBarrier(2);
    const readsBillingSubscriptions =
      mockGetUserSubscription.getMockImplementation();
    mockGetUserSubscription.mockImplementation(async (...args) => {
      await bothReadFirst();
      return readsBillingSubscriptions?.(...args) ?? null;
    });

    const responses = await Promise.all([
      post({ intent: "subscription", planId: "pro" }),
      post({ intent: "subscription", planId: "pro" }),
    ]);

    const statuses = responses.map((response) => response.status).sort();

    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([200, 409]);
  });

  it("guard: the first checkout succeeds and returns a session URL", async () => {
    const first = await post({ intent: "subscription", planId: "pro" });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      url: expect.stringContaining("checkout.stripe.com"),
    });
    // Nothing reached `billing_subscriptions` — which is exactly why the
    // second request below has nothing to trip over.
    expect(db.billing_subscriptions).toHaveLength(0);
    expect(mockCreateCheckoutSession.mock.calls[0]).toEqual([
      USER_ID,
      "buyer@example.com",
      { type: "subscription", planId: "pro", billingPeriod: "monthly" },
      undefined,
      {
        pendingIntentId: pendingIntent?.id,
        expiresAt: pendingIntent?.expires_at,
        priceId: "price_pro_monthly",
      },
    ]);
    expect(mockFindCheckoutSessionForIntent).not.toHaveBeenCalled();
  });

  it("returns a sanitized 409 for a cross-isolate Stripe idempotency conflict", async () => {
    mockBypassUserLock = true;
    mockCreateCheckoutSession
      .mockResolvedValueOnce({
        sessionId: "cs_winner",
        url: "https://checkout.stripe.com/c/pay/cs_winner",
      })
      .mockRejectedValueOnce({
        type: "StripeIdempotencyError",
        code: "idempotency_key_in_use",
        message: "provider detail that must not reach the caller",
      });

    const responses = await Promise.all([
      post({ intent: "subscription", planId: "pro" }),
      post({ intent: "subscription", planId: "pro" }),
    ]);
    const loser = responses.find((response) => response.status === 409);

    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(2);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    await expect(loser?.json()).resolves.toEqual({
      error:
        "A checkout is already being created. Please try again in a moment.",
    });
  });

  it("returns the same sanitized 409 for an idempotency parameter mismatch", async () => {
    pendingIntent = {
      id: "intent_reused",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };
    mockCreateCheckoutSession.mockRejectedValueOnce({
      type: "StripeIdempotencyError",
      code: "idempotency_error",
      message:
        "Keys for idempotent requests can only be used with the same parameters",
    });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "A checkout is already being created. Please try again in a moment.",
    });
  });

  it("a second subscription checkout is refused while the first is still unconfirmed", async () => {
    // Sequential, not concurrent: the first Checkout Session exists and the
    // customer is on Stripe's payment page. Nothing has reached
    // `billing_subscriptions` yet, and nothing stops them opening a second.
    const first = await post({ intent: "subscription", planId: "pro" });
    const second = await post({ intent: "subscription", planId: "pro" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      url: expect.stringContaining("checkout.stripe.com"),
    });
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("expires a Pro yearly session and redirects a new Starter monthly choice", async () => {
    pendingIntent = {
      id: "intent_pro_yearly",
      user_id: USER_ID,
      stripe_session_id: "cs_pro_yearly",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_pro_yearly",
      stripe_price_id: "price_pro_yearly",
      plan_id: "pro",
      billing_period: "yearly",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };
    mockCreateCheckoutSession.mockResolvedValueOnce({
      sessionId: "cs_starter_monthly",
      url: "https://checkout.stripe.com/c/pay/cs_starter_monthly",
    });

    const response = await post({
      intent: "subscription",
      planId: "starter",
      billingPeriod: "monthly",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "cs_starter_monthly",
      url: "https://checkout.stripe.com/c/pay/cs_starter_monthly",
    });
    expect(mockExpireCheckoutSession).toHaveBeenCalledWith("cs_pro_yearly");
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      USER_ID,
      "buyer@example.com",
      { type: "subscription", planId: "starter", billingPeriod: "monthly" },
      undefined,
      expect.objectContaining({
        pendingIntentId: expect.any(String),
        priceId: "price_starter_monthly",
      }),
    );
  });

  it.each([
    {
      label: "Stripe Price",
      stripePriceId: "price_retired_pro_monthly",
      planId: "pro",
      billingPeriod: "monthly",
    },
    {
      label: "billing period",
      stripePriceId: "price_pro_monthly",
      planId: "pro",
      billingPeriod: "yearly",
    },
  ])(
    "replaces a stored checkout when only its $label differs",
    async ({ stripePriceId, planId, billingPeriod }) => {
      pendingIntent = {
        id: "intent_old_choice",
        user_id: USER_ID,
        stripe_session_id: "cs_old_choice",
        checkout_url: "https://checkout.stripe.com/c/pay/cs_old_choice",
        stripe_price_id: stripePriceId,
        plan_id: planId,
        billing_period: billingPeriod,
        expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
      };

      const response = await post({
        intent: "subscription",
        planId: "pro",
        billingPeriod: "monthly",
      });

      expect(response.status).toBe(200);
      expect(mockExpireCheckoutSession).toHaveBeenCalledWith("cs_old_choice");
      expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    },
  );

  it("does not release or replace the intent when session expiry is ambiguous", async () => {
    pendingIntent = {
      id: "intent_pro_yearly",
      user_id: USER_ID,
      stripe_session_id: "cs_pro_yearly",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_pro_yearly",
      stripe_price_id: "price_pro_yearly",
      plan_id: "pro",
      billing_period: "yearly",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };
    mockExpireCheckoutSession.mockRejectedValueOnce(
      new Error("socket timeout"),
    );

    const response = await post({
      intent: "subscription",
      planId: "starter",
      billingPeriod: "monthly",
    });

    expect(response.status).toBe(500);
    expect(mockIntentClient.rpc).not.toHaveBeenCalledWith(
      "finish_subscription_checkout_intent",
      expect.anything(),
    );
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails closed instead of expiring a concurrent successor choice", async () => {
    pendingIntent = {
      id: "intent_original",
      user_id: USER_ID,
      stripe_session_id: "cs_original",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_original",
      stripe_price_id: "price_pro_yearly",
      plan_id: "pro",
      billing_period: "yearly",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };
    pendingIntentAfterFinish = {
      id: "intent_concurrent",
      user_id: USER_ID,
      stripe_session_id: "cs_concurrent",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_concurrent",
      stripe_price_id: "price_pro_monthly",
      plan_id: "pro",
      billing_period: "monthly",
      expires_at: new Date(Date.now() + 50 * 60_000).toISOString(),
    };

    const response = await post({
      intent: "subscription",
      planId: "starter",
      billingPeriod: "monthly",
    });

    expect(response.status).toBe(409);
    expect(mockExpireCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mockExpireCheckoutSession).toHaveBeenCalledWith("cs_original");
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("expires a recovered session when the customer requests a different choice", async () => {
    pendingIntent = {
      id: "intent_pro_yearly",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      stripe_price_id: "price_pro_yearly",
      plan_id: "pro",
      billing_period: "yearly",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };
    mockFindCheckoutSessionForIntent.mockResolvedValueOnce({
      sessionId: "cs_recovered_pro_yearly",
      url: "https://checkout.stripe.com/c/pay/cs_recovered_pro_yearly",
      status: "open",
    });

    const response = await post({
      intent: "subscription",
      planId: "starter",
      billingPeriod: "monthly",
    });

    expect(response.status).toBe(200);
    expect(mockExpireCheckoutSession).toHaveBeenCalledWith(
      "cs_recovered_pro_yearly",
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a concurrent request claimed a different unattached choice", async () => {
    pendingIntent = {
      id: "intent_pro_yearly",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      stripe_price_id: "price_pro_yearly",
      plan_id: "pro",
      billing_period: "yearly",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };

    const response = await post({
      intent: "subscription",
      planId: "starter",
      billingPeriod: "monthly",
    });

    expect(response.status).toBe(409);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    expect(mockExpireCheckoutSession).not.toHaveBeenCalled();
  });

  it("releases an expired unattached different choice after provider recovery finds nothing", async () => {
    pendingIntent = {
      id: "intent_old_choice",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      stripe_price_id: "price_pro_yearly",
      plan_id: "pro",
      billing_period: "yearly",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };

    const response = await post({
      intent: "subscription",
      planId: "starter",
      billingPeriod: "monthly",
    });

    expect(response.status).toBe(200);
    expect(mockIntentClient.rpc).toHaveBeenCalledWith(
      "expire_unattached_subscription_checkout_intent",
      expect.objectContaining({ p_intent_id: "intent_old_choice" }),
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("recovers the same provider session when the attach write failed", async () => {
    failNextAttach = true;
    const first = await post({ intent: "subscription", planId: "pro" });
    expect(first.status).toBe(500);

    mockFindCheckoutSessionForIntent.mockResolvedValue({
      sessionId: "cs_recovered",
      url: "https://checkout.stripe.com/c/pay/cs_recovered",
      status: "open",
    });
    const retry = await post({ intent: "subscription", planId: "pro" });

    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ sessionId: "cs_recovered" });
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("keeps an ambiguous provider failure pending and recovers its session", async () => {
    mockCreateCheckoutSession.mockRejectedValueOnce(
      new Error("socket timeout"),
    );

    const first = await post({ intent: "subscription", planId: "pro" });
    expect(first.status).toBe(500);
    expect(pendingIntent).toMatchObject({
      id: "intent_1",
      stripe_session_id: null,
    });

    mockFindCheckoutSessionForIntent.mockResolvedValue({
      sessionId: "cs_after_timeout",
      url: "https://checkout.stripe.com/c/pay/cs_after_timeout",
      status: "open",
    });
    const retry = await post({ intent: "subscription", planId: "pro" });

    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ sessionId: "cs_after_timeout" });
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("releases a provider-confirmed expired session before creating its successor", async () => {
    pendingIntent = {
      id: "intent_old",
      user_id: USER_ID,
      stripe_session_id: "cs_old",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_old",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    mockGetCheckoutSessionStatus.mockResolvedValue({ status: "expired" });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(200);
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mockIntentClient.rpc).toHaveBeenCalledWith(
      "finish_subscription_checkout_intent",
      expect.objectContaining({
        p_intent_id: "intent_old",
        p_stripe_session_id: "cs_old",
      }),
    );
  });

  it("expires an unattached intent only after provider lookup finds no session", async () => {
    pendingIntent = {
      id: "intent_abandoned",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(200);
    expect(mockFindCheckoutSessionForIntent).toHaveBeenCalledWith(
      USER_ID,
      "buyer@example.com",
      "intent_abandoned",
      undefined,
      expect.any(String),
    );
    expect(mockIntentClient.rpc).toHaveBeenCalledWith(
      "expire_unattached_subscription_checkout_intent",
      expect.objectContaining({ p_intent_id: "intent_abandoned" }),
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("does not retry ambiguous creation once the immutable Stripe expiry is under 30 minutes away", async () => {
    pendingIntent = {
      id: "intent_aging",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    };

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Checkout recovery is still in progress. Try again after the current checkout expires.",
      retryAt: pendingIntent?.expires_at,
    });
    expect(mockFindCheckoutSessionForIntent).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("bounds provider recovery to the lifetime of the reused intent", async () => {
    const expiresAt = new Date(Date.now() + 45 * 60_000).toISOString();
    pendingIntent = {
      id: "intent_reused",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      expires_at: expiresAt,
    };

    await post({ intent: "subscription", planId: "pro" });

    expect(mockFindCheckoutSessionForIntent).toHaveBeenCalledWith(
      USER_ID,
      "buyer@example.com",
      "intent_reused",
      undefined,
      new Date(Date.parse(expiresAt) - 60 * 60_000).toISOString(),
    );
  });

  it("explains that a completed checkout is waiting for reconciliation", async () => {
    pendingIntent = {
      id: "intent_complete",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };
    mockFindCheckoutSessionForIntent.mockResolvedValue({
      sessionId: "cs_complete",
      url: null,
      status: "complete",
    });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Your checkout completed, but your subscription is still being reconciled. Refresh shortly, or contact support if access does not appear.",
    });
  });

  it("does not present a stored URL as resumable after the attached session completed", async () => {
    pendingIntent = {
      id: "intent_attached_complete",
      user_id: USER_ID,
      stripe_session_id: "cs_attached_complete",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_attached_complete",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };
    mockGetCheckoutSessionStatus.mockResolvedValue({ status: "complete" });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Your checkout completed, but your subscription is still being reconciled. Refresh shortly, or contact support if access does not appear.",
    });
  });

  it("fails closed when the subscription recheck cannot be read", async () => {
    failSubscriptionRead = true;

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(500);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic intent claim fails", async () => {
    failClaim = true;

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(500);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns 409 when the atomic claim observes a subscription persisted in the race", async () => {
    blockClaimForSubscription = true;

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("already have a subscription"),
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  /**
   * Fix-stable: once the webhook has written the row, the guard works. This is
   * the state the current check assumes always holds.
   */
  it("refuses a second checkout once the webhook has recorded the subscription", async () => {
    db.billing_subscriptions = [
      { id: "row_1", user_id: USER_ID, plan: "pro", status: "active" },
    ];

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("already have a subscription"),
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it.each(["incomplete", "past_due", "unpaid", "paused"])(
    "blocks a recoverable %s obligation while its latest invoice payment is processing",
    async (status) => {
      db.billing_subscriptions = [
        { id: "row_1", user_id: USER_ID, plan: "pro", status },
      ];
      mockGetRecoverableSubscriptionCheckout.mockResolvedValueOnce({
        kind: "processing",
      });

      const response = await post({ intent: "subscription", planId: "pro" });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error:
          "A payment is still processing on your current subscription. We'll email you when it clears.",
      });
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    },
  );

  it("returns the invoice recovery URL instead of creating a replacement subscription", async () => {
    mockGetRecoverableSubscriptionCheckout.mockResolvedValueOnce({
      kind: "resume",
      resumeUrl: "https://invoice.stripe.com/i/in_1",
    });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Your current subscription needs attention before you can start another checkout.",
      resumeUrl: "https://invoice.stripe.com/i/in_1",
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns the upgrade conflict when Stripe recovered the subscription to active", async () => {
    mockGetRecoverableSubscriptionCheckout.mockResolvedValueOnce({
      kind: "already_subscribed",
    });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "You already have a subscription. Use the upgrade flow to change plans.",
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns a clear recovery message when a paused subscription has no portal", async () => {
    mockGetRecoverableSubscriptionCheckout.mockResolvedValueOnce({
      kind: "paused_without_portal",
    });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Your subscription is paused. Contact support to resume it before starting another checkout.",
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("blocks replacement when the current invoice has no recovery URL", async () => {
    mockGetRecoverableSubscriptionCheckout.mockResolvedValueOnce({
      kind: "unavailable",
    });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Your current subscription needs attention before another checkout can start. Contact support if no payment link is available.",
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("rate-limits by IP before authentication with a fail-open store policy", async () => {
    const ipLimited = {
      status: 503,
      headers: new Headers({ "Retry-After": "60" }),
      json: async () => ({ error: "Too many requests" }),
    } as never;
    mockEnforceRateLimit.mockResolvedValueOnce(ipLimited);

    const first = await post({
      intent: "lifetime",
      productId: "lifetime_agency",
    });

    expect(first.status).toBe(503);
    expect(first.headers.get("Retry-After")).toBe("60");
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockReserveFoundingAgencySpot).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        limit: "CHECKOUT_IP",
        endpoint: "billing/checkout:ip",
        identifierType: "ip",
        onStoreFailure: "allow",
      }),
    );
  });

  it("does not charge the new-session quota when resuming an open subscription checkout", async () => {
    pendingIntent = {
      id: "intent_open",
      user_id: USER_ID,
      stripe_session_id: "cs_open",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_open",
      stripe_price_id: "price_pro_monthly",
      plan_id: "pro",
      billing_period: "monthly",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(409);
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("charges the fail-open user quota immediately before a new subscription session", async () => {
    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(200);
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        limit: "CHECKOUT_USER",
        endpoint: "billing/checkout:new-session",
        identifier: USER_ID,
        identifierType: "user",
        onStoreFailure: "allow",
      }),
    );
    expect(mockEnforceRateLimit.mock.invocationCallOrder[1]).toBeLessThan(
      mockCreateCheckoutSession.mock.invocationCallOrder[0],
    );
  });

  it("keeps a rate-limited subscription intent for an idempotent retry", async () => {
    const limited = {
      status: 429,
      headers: new Headers({ "Retry-After": "60" }),
      json: async () => ({ error: "Rate limit exceeded" }),
    } as never;
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(limited);

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(429);
    expect(pendingIntent).toMatchObject({
      id: "intent_1",
      stripe_session_id: null,
    });
    expect(mockIntentClient.rpc).not.toHaveBeenCalledWith(
      "expire_unattached_subscription_checkout_intent",
      expect.anything(),
    );
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("charges an unattached reused intent because it is not a confirmed open-session resume", async () => {
    pendingIntent = {
      id: "intent_ambiguous",
      user_id: USER_ID,
      stripe_session_id: null,
      checkout_url: null,
      stripe_price_id: "price_pro_monthly",
      plan_id: "pro",
      billing_period: "monthly",
      expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    };

    await post({ intent: "subscription", planId: "pro" });

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ endpoint: "billing/checkout:new-session" }),
    );
  });

  it("caps new sessions at 10 per user per 15 minutes", () => {
    expect(RATE_LIMIT_CONFIGS.CHECKOUT_USER).toEqual({
      maxRequests: 10,
      windowMs: 15 * 60 * 1000,
    });
  });

  it("uses the fail-open user quota for a credit checkout", async () => {
    const response = await post({ intent: "credits", quantity: 1 });

    expect(response.status).toBe(200);
    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        endpoint: "billing/checkout:new-session",
        onStoreFailure: "allow",
      }),
    );
  });

  it("uses the sole fail-closed user quota before starting a new founding session", async () => {
    await post({ intent: "lifetime", productId: "lifetime_agency" });

    expect(mockEnforceRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        limit: "CHECKOUT_USER",
        endpoint: "billing/checkout:new-session",
        identifier: USER_ID,
        identifierType: "user",
        onStoreFailure: "deny",
      }),
    );
    expect(mockEnforceRateLimit.mock.invocationCallOrder[1]).toBeLessThan(
      mockCreateCheckoutSession.mock.invocationCallOrder[0],
    );
  });

  it("does not charge the new-session quota when resuming a founding checkout", async () => {
    mockGetOpenFoundingAgencyCheckout.mockResolvedValueOnce({
      sessionId: "cs_founding_open",
      url: "https://checkout.stripe.com/c/pay/cs_founding_open",
    });

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_agency",
    });

    expect(response.status).toBe(200);
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      sessionId: "cs_founding_open",
      url: "https://checkout.stripe.com/c/pay/cs_founding_open",
    });
    expect(mockReserveFoundingAgencySpot).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("does not reserve a founding hold when the user quota rejects it", async () => {
    const limited = {
      status: 429,
      headers: new Headers({ "Retry-After": "60" }),
      json: async () => ({ error: "Rate limit exceeded" }),
    } as never;
    mockEnforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(limited);

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_agency",
    });

    expect(response.status).toBe(429);
    expect(mockReserveFoundingAgencySpot).not.toHaveBeenCalled();
    expect(mockReleaseFoundingAgencyCheckout).not.toHaveBeenCalled();
    expect(mockPreflightLifetimeCheckout).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  /**
   * Fix-stable, and the contrast the finding draws: the more expensive product
   * already has a server-side precondition beside the same missing one.
   */
  it("refuses a lifetime purchase the customer already holds a grant for", async () => {
    mockGetGrantedPlanIds.mockResolvedValue(["pro"]);

    const response = await post({ intent: "lifetime" });

    expect(response.status).toBe(409);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    ["sold_out", "sold out"],
    ["capacity_busy", "temporarily held"],
  ])(
    "returns a clear %s response before Stripe checkout",
    async (outcome, message) => {
      mockReserveFoundingAgencySpot.mockResolvedValue({
        outcome,
        reservationId: null,
        checkoutExpiresAt: null,
      });

      const response = await post({
        intent: "lifetime",
        productId: "lifetime_agency",
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining(message),
      });
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    },
  );

  it("binds the founding reservation before returning checkout", async () => {
    const response = await post({
      intent: "lifetime",
      productId: "lifetime_agency",
    });

    expect(response.status).toBe(200);
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      USER_ID,
      "buyer@example.com",
      expect.objectContaining({
        productId: "lifetime_agency",
        reservationId: "reservation-1",
        checkoutExpiresAt: 1_800_000_000,
      }),
      undefined,
    );
    expect(mockBindFoundingAgencyCheckout).toHaveBeenCalledWith(
      "reservation-1",
      USER_ID,
      expect.any(String),
      1_800_000_000,
    );
    expect(
      mockPreflightLifetimeCheckout.mock.invocationCallOrder[0],
    ).toBeLessThan(mockReserveFoundingAgencySpot.mock.invocationCallOrder[0]);
    expect(
      mockReconcileExpiredFoundingAgencyCheckouts.mock.invocationCallOrder[0],
    ).toBeLessThan(mockReserveFoundingAgencySpot.mock.invocationCallOrder[0]);
  });

  it("explains that a refunded founding purchase does not reopen a limited spot", async () => {
    mockReserveFoundingAgencySpot.mockResolvedValue({
      outcome: "refunded",
      reservationId: null,
      checkoutExpiresAt: null,
    });

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_agency",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/refunded.*not reopened/i),
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("does not reserve capacity when founding checkout preflight fails", async () => {
    mockPreflightLifetimeCheckout.mockRejectedValue(
      new Error("No Stripe price configured for Founding Agency"),
    );

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_agency",
    });

    expect(response.status).toBe(500);
    expect(mockReserveFoundingAgencySpot).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    ["StripeInvalidRequestError", "resource_missing"],
    ["StripeAuthenticationError", undefined],
    ["StripePermissionError", undefined],
  ])(
    "releases an unbound founding hold after %s rejects session creation",
    async (type, code) => {
      mockCreateCheckoutSession.mockRejectedValueOnce({
        type,
        code,
        message: "Stripe rejected the request before creating a session",
      });

      const response = await post({
        intent: "lifetime",
        productId: "lifetime_agency",
      });

      expect(response.status).toBe(500);
      expect(mockReleaseFoundingAgencyCheckout).toHaveBeenCalledWith(
        "reservation-1",
        USER_ID,
        null,
      );
    },
  );

  it.each([
    ["StripeConnectionError", undefined],
    ["StripeAPIError", undefined],
    ["StripeRateLimitError", undefined],
    ["StripeIdempotencyError", undefined],
    ["StripeInvalidRequestError", "idempotency_key_in_use"],
  ])(
    "retains a founding hold when session creation fails with %s/%s",
    async (type, code) => {
      mockCreateCheckoutSession.mockRejectedValueOnce({
        type,
        code,
        message: "Stripe outcome may be uncertain",
      });

      const response = await post({
        intent: "lifetime",
        productId: "lifetime_agency",
      });

      expect(response.status).toBe(500);
      expect(mockReleaseFoundingAgencyCheckout).not.toHaveBeenCalled();
    },
  );

  it("keeps Lifetime Pro from cancelling an Agency subscription", async () => {
    mockGetUserSubscription.mockResolvedValueOnce({ plan_id: "agency" });

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_pro",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Agency subscription"),
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails closed when Lifetime Pro eligibility cannot read the live subscription", async () => {
    mockGetUserSubscription.mockRejectedValueOnce(
      new Error("Failed to read current subscription: database unavailable"),
    );

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_pro",
    });

    expect(response.status).toBe(500);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("keeps an Agency lifetime owner from buying Lifetime Pro for no benefit", async () => {
    mockGetGrantedPlanIds.mockResolvedValue(["agency"]);

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_pro",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Agency lifetime"),
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it.each([
    { intent: "subscription", planId: "agency" },
    { intent: "lifetime", productId: "lifetime_agency" },
  ])(
    "withdraws new Agency checkout when the operator switch is off",
    async (body) => {
      process.env.AGENCY_CHECKOUT_ENABLED = "false";

      const response = await post(body);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("temporarily unavailable"),
      });
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
      expect(mockReserveFoundingAgencySpot).not.toHaveBeenCalled();
    },
  );

  it("keeps Lifetime Pro available when Agency checkout is withdrawn", async () => {
    process.env.AGENCY_CHECKOUT_ENABLED = "false";

    const response = await post({
      intent: "lifetime",
      productId: "lifetime_pro",
    });

    expect(response.status).toBe(200);
    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthenticated caller before creating anything", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await post({ intent: "subscription", planId: "pro" });

    expect(response.status).toBe(401);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });
});
